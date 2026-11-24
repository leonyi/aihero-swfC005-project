import Knock, { NotFoundError } from "@knocklabs/node";
import type { PreferenceSet as KnockPreferenceSet } from "@knocklabs/node/resources/recipients/preferences";
import {
  NOTIFICATION_KINDS,
  type Notification,
  type NotificationChannel,
  type NotificationKind,
  type NotificationPort,
  type NotificationUser,
  type PreferenceCategory,
  type PreferenceSet,
} from "~/lib/notifications.server";

// ─── Knock adapter ───
// The only code that talks to Knock. It maps Cadence's Notification kinds,
// preference categories and channels to Knock's workflow, category and channel
// type keys. Knock user ids are Cadence user ids as strings.

/** Each kind's Knock workflow key and display name. */
export const KNOCK_WORKFLOWS: Record<
  NotificationKind,
  { key: string; name: string }
> = {
  "refund-request-confirmed": {
    key: "refund-request-confirmed",
    name: "Refund Request confirmation",
  },
  "refund-request-approved": {
    key: "refund-request-approved",
    name: "Refund Request approved",
  },
  "refund-request-declined": {
    key: "refund-request-declined",
    name: "Refund Request declined",
  },
  "open-refund-request": { key: "open-refund-request", name: "Open Refund Request" },
  "seat-claimed": { key: "seat-claimed", name: "Seat claimed" },
  "new-enrollment": { key: "new-enrollment", name: "New Enrollment" },
  "discussion-question": { key: "discussion-question", name: "Discussion Question" },
  "discussion-reply": { key: "discussion-reply", name: "Discussion Reply" },
};

/**
 * Knock category keys. `enrollment` matches the category the Knock prototype
 * already created, so preferences written then still apply.
 */
export const KNOCK_CATEGORIES: Record<PreferenceCategory, string> = {
  "refund-request-updates": "refund_request_updates",
  "open-refund-requests": "open_refund_requests",
  "seat-claims": "seat_claims",
  enrollments: "enrollment",
  "discussion-questions": "discussion_questions",
  "discussion-replies": "discussion_replies",
};

export const KNOCK_CHANNEL_TYPES: Record<NotificationChannel, string> = {
  feed: "in_app_feed",
};

const PREFERENCE_SET_ID = "default";

function knockUser(user: NotificationUser) {
  return {
    id: String(user.id),
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
  };
}

export function toKnockTrigger(notification: Notification) {
  return {
    workflowKey: KNOCK_WORKFLOWS[notification.kind].key,
    body: {
      recipients: notification.recipients.map(knockUser),
      ...(notification.actor ? { actor: knockUser(notification.actor) } : {}),
      data: notification.data,
    },
    idempotencyKey: notification.idempotencyKey,
  };
}

type KnockCategorySetting = {
  channel_types: Record<string, boolean>;
};

/** The `categories` of a Knock preference set holding only these changes. */
export function toKnockPreferences(
  changes: PreferenceSet
): Record<string, KnockCategorySetting> {
  const categories: Record<string, KnockCategorySetting> = {};
  for (const category of Object.keys(KNOCK_CATEGORIES) as PreferenceCategory[]) {
    const channels = changes[category];
    if (!channels) continue;
    const channelTypes: Record<string, boolean> = {};
    for (const channel of Object.keys(KNOCK_CHANNEL_TYPES) as NotificationChannel[]) {
      const on = channels[channel];
      if (on !== undefined) channelTypes[KNOCK_CHANNEL_TYPES[channel]] = on;
    }
    categories[KNOCK_CATEGORIES[category]] = { channel_types: channelTypes };
  }
  return categories;
}

/** Cadence's view of a Knock preference set, or null when it has none. */
export function fromKnockPreferences(
  set: KnockPreferenceSet
): PreferenceSet | null {
  const knockCategories = set.categories ?? {};
  if (Object.keys(knockCategories).length === 0) return null;

  const preferences: PreferenceSet = {};
  for (const category of Object.keys(KNOCK_CATEGORIES) as PreferenceCategory[]) {
    const setting = knockCategories[KNOCK_CATEGORIES[category]];
    if (setting === undefined) continue;
    const channels: Partial<Record<NotificationChannel, boolean>> = {};
    const channelTypes: Partial<Record<string, unknown>> =
      typeof setting === "boolean" ? {} : { ...setting.channel_types };
    for (const channel of Object.keys(KNOCK_CHANNEL_TYPES) as NotificationChannel[]) {
      const on =
        typeof setting === "boolean"
          ? setting
          : channelTypes[KNOCK_CHANNEL_TYPES[channel]];
      if (typeof on === "boolean") channels[channel] = on;
    }
    preferences[category] = channels;
  }
  return preferences;
}

export type KnockWorkflowDefinition = {
  key: string;
  workflow: {
    name: string;
    categories: string[];
    steps: Array<{
      ref: string;
      type: "channel";
      channel_key: string;
      template: { markdown_body: string; action_url: string };
    }>;
  };
};

/**
 * Every workflow as the Knock Management API takes it: one in-app feed step in
 * the kind's category. The feed renders rows from trigger data, so the
 * template is only a fallback.
 */
export function knockWorkflowDefinitions(
  feedChannelKey: string
): KnockWorkflowDefinition[] {
  return (Object.keys(KNOCK_WORKFLOWS) as NotificationKind[]).map((kind) => ({
    key: KNOCK_WORKFLOWS[kind].key,
    workflow: {
      name: KNOCK_WORKFLOWS[kind].name,
      categories: [KNOCK_CATEGORIES[NOTIFICATION_KINDS[kind].category]],
      steps: [
        {
          ref: "in_app_feed_1",
          type: "channel",
          channel_key: feedChannelKey,
          template: {
            markdown_body: `${KNOCK_WORKFLOWS[kind].name}: {{ data.courseTitle }}`,
            action_url: "{{ data.url }}",
          },
        },
      ],
    },
  }));
}

export function knockNotificationPort(secretApiKey: string): NotificationPort {
  const knock = new Knock({ apiKey: secretApiKey });

  return {
    async trigger(notification) {
      const { workflowKey, body, idempotencyKey } = toKnockTrigger(notification);
      await knock.workflows.trigger(workflowKey, body, { idempotencyKey });
    },

    async identifyUser(user) {
      const { id, ...properties } = knockUser(user);
      await knock.users.update(id, properties);
    },

    async getPreferences(userId) {
      try {
        const set = await knock.users.getPreferences(
          String(userId),
          PREFERENCE_SET_ID
        );
        return fromKnockPreferences(set);
      } catch (error) {
        if (error instanceof NotFoundError) return null;
        throw error;
      }
    },

    async mergePreferences(userId, changes) {
      await knock.users.setPreferences(String(userId), PREFERENCE_SET_ID, {
        categories: toKnockPreferences(changes),
        // Knock replaces the whole set by default.
        __persistence_strategy__: "merge",
      });
    },

    async archiveForComment(commentId) {
      const messageIds: string[] = [];
      for await (const message of knock.messages.list({
        trigger_data: JSON.stringify({ commentId }),
      })) {
        messageIds.push(message.id);
      }
      // Knock answers 422 to an empty batch.
      if (messageIds.length === 0) return;
      await knock.messages.batch.archive({ message_ids: messageIds });
    },
  };
}
