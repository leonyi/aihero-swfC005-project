import Knock from "@knocklabs/client";
import { z } from "zod";
import type {
  NotificationFeedClient,
  NotificationFeedConfig,
  FeedNotification,
} from "~/lib/notification-feed-client";
import type {
  NotificationDataByKind,
  NotificationKind,
} from "~/lib/notifications.server";
import { KNOCK_WORKFLOWS } from "~/lib/knock-workflows";

// ─── Knock adapter for the Notification Feed (browser) ───
// The only browser code that talks to Knock. It reads the person's feed with
// the public key and their signed user token, and listens on Knock's
// real-time socket (one per signed-in person). Nothing polls.

const PAGE_SIZE = 20;

const KIND_BY_WORKFLOW = new Map(
  (Object.keys(KNOCK_WORKFLOWS) as NotificationKind[]).map((kind) => [
    KNOCK_WORKFLOWS[kind].key,
    kind,
  ])
);

// Trigger data comes back from Knock, so it is parsed, not trusted.
const linkTarget = { url: z.string().nullable() };
const discussion = z.object({
  ...linkTarget,
  courseTitle: z.string(),
  lessonTitle: z.string(),
  snippet: z.string(),
  commentId: z.number(),
});
const refund = { ...linkTarget, courseTitle: z.string(), amount: z.number() };
const decision = z.object({
  ...refund,
  purchaseId: z.number(),
  purchasedAt: z.string(),
  decisionNote: z.string().nullable(),
});
const withReason = z.object({ ...refund, reason: z.string() });

const DATA_SCHEMAS: {
  [K in NotificationKind]: z.ZodType<NotificationDataByKind[K]>;
} = {
  "refund-request-confirmed": withReason,
  "refund-request-approved": decision,
  "refund-request-declined": decision,
  "open-refund-request": withReason,
  "seat-claimed": z.object({
    ...linkTarget,
    courseTitle: z.string(),
    seatsLeft: z.number(),
  }),
  "new-enrollment": z.object({ ...linkTarget, courseTitle: z.string() }),
  "discussion-question": discussion,
  "discussion-reply": discussion,
};

const feedEntrySchema = z.object({
  id: z.string(),
  inserted_at: z.string(),
  read_at: z.string().nullable(),
  seen_at: z.string().nullable(),
  actors: z.array(
    z.object({ name: z.string().nullish(), avatar: z.string().nullish() })
  ),
  data: z.unknown(),
  source: z.object({ key: z.string() }),
});

const feedResponseSchema = z.object({
  entries: z.array(z.unknown()),
  meta: z.object({ unseen_count: z.number(), unread_count: z.number() }),
  page_info: z.object({ after: z.string().nullish() }),
});

// One option per kind, so the parsed kind and data come out as a pair.
const option = <K extends NotificationKind>(kind: K) =>
  z.object({ kind: z.literal(kind), data: DATA_SCHEMAS[kind] });

const kindAndDataSchema = z.discriminatedUnion("kind", [
  option("refund-request-confirmed"),
  option("refund-request-approved"),
  option("refund-request-declined"),
  option("open-refund-request"),
  option("seat-claimed"),
  option("new-enrollment"),
  option("discussion-question"),
  option("discussion-reply"),
]);

/**
 * Cadence's view of one Knock feed entry, or null when it isn't one of
 * Cadence's Notification kinds (e.g. left over from a prototype).
 */
export function fromKnockFeedItem(item: unknown): FeedNotification | null {
  const entry = feedEntrySchema.safeParse(item);
  if (!entry.success) return null;
  const kind = KIND_BY_WORKFLOW.get(entry.data.source.key);
  if (!kind) return null;
  const parsed = kindAndDataSchema.safeParse({ kind, data: entry.data.data });
  if (!parsed.success) return null;
  const sender = entry.data.actors[0];
  return {
    id: entry.data.id,
    insertedAt: entry.data.inserted_at,
    readAt: entry.data.read_at,
    seenAt: entry.data.seen_at,
    actor: sender?.name
      ? { name: sender.name, avatarUrl: sender.avatar ?? null }
      : null,
    ...parsed.data,
  };
}

export function knockNotificationFeedClient(
  config: NotificationFeedConfig,
  /** Fetches a fresh user token before the current one expires. */
  refreshUserToken: () => Promise<string | undefined>
): NotificationFeedClient {
  const userId = String(config.userId);
  const knock = new Knock(config.publicApiKey);
  knock.authenticate({ id: userId }, config.userToken, {
    identificationStrategy: "skip",
    onUserTokenExpiring: refreshUserToken,
    timeBeforeExpirationInMs: 60_000,
  });
  const feed = knock.feeds.initialize(config.feedChannelId, {
    page_size: PAGE_SIZE,
    archived: "exclude",
  });
  feed.listenForUpdates();

  return {
    async list(cursor) {
      const response = await knock.client().makeRequest({
        method: "GET",
        url: `/v1/users/${encodeURIComponent(userId)}/feeds/${config.feedChannelId}`,
        params: {
          page_size: PAGE_SIZE,
          archived: "exclude",
          ...(cursor ? { after: cursor } : {}),
        },
      });
      if (response.statusCode === "error") {
        throw new Error(`Knock feed answered ${response.status}`);
      }
      const body = feedResponseSchema.parse(response.body);
      return {
        notifications: body.entries
          .map(fromKnockFeedItem)
          .filter((n): n is FeedNotification => n !== null),
        nextCursor: body.page_info.after ?? null,
        counts: {
          unseen: body.meta.unseen_count,
          unread: body.meta.unread_count,
        },
      };
    },

    async markRead(notificationId) {
      await knock.messages.batchUpdateStatuses([notificationId], "read");
    },

    // Bulk by channel, so Notifications that haven't loaded are covered.
    async markAllSeen() {
      await knock.messages.bulkUpdateAllStatusesInChannel({
        channelId: config.feedChannelId,
        status: "seen",
        options: { user_ids: [userId] },
      });
    },

    async markAllRead() {
      await knock.messages.bulkUpdateAllStatusesInChannel({
        channelId: config.feedChannelId,
        status: "read",
        options: { user_ids: [userId] },
      });
    },

    subscribe(onChange) {
      const listener = () => onChange();
      feed.on("items.received.realtime", listener);
      return () => feed.off("items.received.realtime", listener);
    },

    close() {
      feed.dispose();
      knock.teardown();
    },
  };
}
