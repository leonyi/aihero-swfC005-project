import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { users } from "~/db/schema";

// ─── Notifications ───
// Cadence tells a person something that concerns them happened. The domain
// services decide who gets which Notification and with what data; they hand it
// to a NotificationPort, which delivers it. The port speaks Cadence's language
// (Notification kinds, preference categories, the `feed` channel). Only the
// Knock adapter (notifications-knock.server.ts) knows Knock's keys.
//
// Implementations:
// - knockNotificationPort: the real one. getNotificationPort()
//   (notification-port.server.ts) picks it when KNOCK_SECRET_API_KEY is set.
// - loggingNotificationPort: logs instead of sending (local dev without keys).
// - createFakeNotificationPort (notifications.fake.ts): records calls, for tests.

// ─── Catalogue ───

/** Someone Cadence knows, as a Notification's recipient or sender. */
export type NotificationUser = {
  id: number;
  name: string;
  email: string;
  avatarUrl: string | null;
};

/** The person as a Notification's recipient or sender, or undefined if gone. */
export function getNotificationUser(
  db: BetterSQLite3Database<typeof schema>,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/**
 * Where clicking the Notification goes, or null when there's nowhere to go
 * (the Refund Request confirmation).
 */
type LinkTarget = { url: string | null };

type DiscussionData = LinkTarget & {
  courseTitle: string;
  lessonTitle: string;
  snippet: string;
  commentId: number;
};

type RefundData = LinkTarget & {
  courseTitle: string;
  /** In cents. */
  amount: number;
};

/** A decided Refund Request names the Purchase it was for. */
type DecisionData = RefundData & {
  purchaseId: number;
  /** When the Purchase was made, as an ISO timestamp. */
  purchasedAt: string;
  decisionNote: string | null;
};

/**
 * The data each Notification kind carries. The Notification Feed renders its
 * row from this data, so it is a snapshot taken when the Notification is sent.
 * Adding a kind here makes every catalogue below fail the typecheck until the
 * kind is added to it, including the Knock adapter's workflow keys.
 */
export type NotificationDataByKind = {
  "refund-request-confirmed": RefundData & { reason: string };
  "refund-request-approved": DecisionData;
  "refund-request-declined": DecisionData;
  "open-refund-request": RefundData & { reason: string };
  "seat-claimed": LinkTarget & { courseTitle: string; seatsLeft: number };
  "new-enrollment": LinkTarget & { courseTitle: string };
  "discussion-question": DiscussionData;
  "discussion-reply": DiscussionData;
};

export type NotificationKind = keyof NotificationDataByKind;

export type PreferenceCategory =
  | "refund-request-updates"
  | "open-refund-requests"
  | "seat-claims"
  | "enrollments"
  | "discussion-questions"
  | "discussion-replies";

/** Only the Notification Feed is used in v1; email may follow. */
export type NotificationChannel = "feed";

export const NOTIFICATION_KINDS: Record<
  NotificationKind,
  { category: PreferenceCategory }
> = {
  "refund-request-confirmed": { category: "refund-request-updates" },
  "refund-request-approved": { category: "refund-request-updates" },
  "refund-request-declined": { category: "refund-request-updates" },
  "open-refund-request": { category: "open-refund-requests" },
  "seat-claimed": { category: "seat-claims" },
  "new-enrollment": { category: "enrollments" },
  "discussion-question": { category: "discussion-questions" },
  "discussion-reply": { category: "discussion-replies" },
};

export const PREFERENCE_CATEGORIES: Record<
  PreferenceCategory,
  { label: string; onByDefault: boolean }
> = {
  "refund-request-updates": { label: "Refund Request updates", onByDefault: true },
  "open-refund-requests": { label: "Open Refund Requests", onByDefault: true },
  "seat-claims": { label: "Seat claims", onByDefault: true },
  enrollments: { label: "Enrollments", onByDefault: false },
  "discussion-questions": { label: "Discussion Questions", onByDefault: true },
  "discussion-replies": { label: "Discussion Replies", onByDefault: true },
};

/** One Notification kind, sent to its recipients. */
export type Notification = {
  [K in NotificationKind]: {
    kind: K;
    recipients: NotificationUser[];
    /** The person whose action caused it, or null when Cadence itself sent it. */
    actor: NotificationUser | null;
    data: NotificationDataByKind[K];
    /** One per domain event, e.g. `discussion-question:<commentId>`. */
    idempotencyKey: string;
  };
}[NotificationKind];

/**
 * A person's preferences, category × channel. Partial: a category or channel
 * missing from the set is left as it is (on read: not set yet).
 */
export type PreferenceSet = Partial<
  Record<PreferenceCategory, Partial<Record<NotificationChannel, boolean>>>
>;

// ─── Port ───

export interface NotificationPort {
  /** Sends one Notification to its recipients. */
  trigger(notification: Notification): Promise<void>;
  /** Creates or updates the person's name, email and avatar with the vendor. */
  identifyUser(user: NotificationUser): Promise<void>;
  /** The person's preference set, or null when they have none yet. */
  getPreferences(userId: number): Promise<PreferenceSet | null>;
  /** Merges `changes` into the person's preference set, leaving the rest. */
  mergePreferences(userId: number, changes: PreferenceSet): Promise<void>;
  /** Archives every Notification the comment caused, for every recipient. */
  archiveForComment(commentId: number): Promise<void>;
}

export function loggingNotificationPort(
  log: (message: string) => void = console.log
): NotificationPort {
  return {
    async trigger(notification) {
      const to = notification.recipients.map((r) => r.id).join(", ");
      log(
        `[notifications] ${notification.kind} → users ${to} (${notification.idempotencyKey}) ${JSON.stringify(notification.data)}`
      );
    },
    async identifyUser(user) {
      log(`[notifications] identify user ${user.id} (${user.email})`);
    },
    async getPreferences() {
      return null;
    },
    async mergePreferences(userId, changes) {
      log(`[notifications] merge preferences for user ${userId} ${JSON.stringify(changes)}`);
    },
    async archiveForComment(commentId) {
      log(`[notifications] archive Notifications for comment ${commentId}`);
    },
  };
}

// ─── Best effort ───
// A Notification never fails the action that caused it. Call these after the
// domain write commits: a failure is logged and swallowed, never retried.

export async function bestEffort(
  what: string,
  work: () => Promise<void>
): Promise<void> {
  try {
    await work();
  } catch (error) {
    console.error(`[notifications] ${what} failed`, error);
  }
}

export function notify(
  port: NotificationPort,
  notification: Notification
): Promise<void> {
  return bestEffort(
    `${notification.kind} (${notification.idempotencyKey})`,
    () => port.trigger(notification)
  );
}

/** Plain one-line excerpt of a comment for a Notification row. */
export function snippetOf(body: string, maxLength = 140): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= maxLength
    ? flat
    : `${flat.slice(0, maxLength - 1).trimEnd()}…`;
}
