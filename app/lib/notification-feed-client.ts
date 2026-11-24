import type {
  NotificationDataByKind,
  NotificationKind,
} from "~/lib/notifications.server";

// ─── Notification Feed client interface ───
// What the browser's Notification Feed needs from the vendor, in Cadence's
// language. The feed components only call this interface. Implementations:
// - knockNotificationFeedClient (notification-feed-knock.ts): Knock, with the
//   public key and a signed user token, live updates over Knock's socket.
// - emptyNotificationFeedClient: no Knock keys, so the feed is empty.
// - createFakeNotificationFeedClient (notification-feed.fake.ts): for tests.

/** The person whose action caused a Notification. */
export type FeedActor = { name: string; avatarUrl: string | null };

/** One Notification as the Notification Feed shows it. */
export type FeedNotification = {
  [K in NotificationKind]: {
    id: string;
    kind: K;
    /** ISO timestamp of when it arrived. */
    insertedAt: string;
    readAt: string | null;
    seenAt: string | null;
    /** Null when Cadence itself sent it (the Refund Request confirmation). */
    actor: FeedActor | null;
    data: NotificationDataByKind[K];
  };
}[NotificationKind];

/** What the server hands the browser so it can open the person's feed. */
export type NotificationFeedConfig = {
  userId: number;
  /** RS256, signed for this person only. */
  userToken: string;
  publicApiKey: string;
  feedChannelId: string;
};

export type FeedCounts = { unseen: number; unread: number };

export type FeedPage = {
  /** Newest first. */
  notifications: FeedNotification[];
  /** Pass to `list` for the next, older page; null when there is none. */
  nextCursor: string | null;
  counts: FeedCounts;
};

export interface NotificationFeedClient {
  /** One page of the person's Notifications, newest first. */
  list(cursor: string | null): Promise<FeedPage>;
  markRead(notificationId: string): Promise<void>;
  /** Every Notification in the channel, loaded or not. */
  markAllSeen(): Promise<void>;
  /** Every Notification in the channel, loaded or not. */
  markAllRead(): Promise<void>;
  /** Calls `onChange` when the feed changes live. Returns an unsubscribe. */
  subscribe(onChange: () => void): () => void;
  /** Disconnects; the client is not used again. */
  close(): void;
}

/** Without Knock keys there is nothing to show: the feed is always empty. */
export const emptyNotificationFeedClient: NotificationFeedClient = {
  async list() {
    return { notifications: [], nextCursor: null, counts: { unseen: 0, unread: 0 } };
  },
  async markRead() {},
  async markAllSeen() {},
  async markAllRead() {},
  subscribe() {
    return () => {};
  },
  close() {},
};
