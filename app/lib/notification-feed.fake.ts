import type {
  FeedNotification,
  NotificationFeedClient,
} from "~/lib/notification-feed-client";

// ─── In-memory NotificationFeedClient for tests ───
// Holds one person's Notifications the way the vendor would: paged by cursor,
// newest first, archived ones left out. `receive` and `archive` change the
// feed as the server would and notify live subscribers.

export type FakeNotificationFeedClient = NotificationFeedClient & {
  /** Every Notification, archived or not, in any order. */
  all: FeedNotification[];
  archivedIds: Set<string>;
  listCalls: Array<string | null>;
  markReadCalls: string[];
  markAllSeenCalls: number;
  markAllReadCalls: number;
  closed: boolean;
  /** A new Notification arrives, and subscribers hear about it. */
  receive(notification: FeedNotification): void;
  /** A Notification is archived server-side (its comment was deleted). */
  archive(notificationId: string): void;
};

export function createFakeNotificationFeedClient(
  notifications: FeedNotification[] = [],
  pageSize = 20
): FakeNotificationFeedClient {
  const listeners = new Set<() => void>();
  const now = () => new Date().toISOString();

  const visible = () =>
    fake.all
      .filter((n) => !fake.archivedIds.has(n.id))
      .sort((a, b) => b.insertedAt.localeCompare(a.insertedAt));

  const fake: FakeNotificationFeedClient = {
    all: [...notifications],
    archivedIds: new Set(),
    listCalls: [],
    markReadCalls: [],
    markAllSeenCalls: 0,
    markAllReadCalls: 0,
    closed: false,

    async list(cursor) {
      fake.listCalls.push(cursor);
      const shown = visible();
      const start = cursor === null ? 0 : Number(cursor);
      const end = start + pageSize;
      return {
        notifications: shown.slice(start, end).map((n) => ({ ...n })),
        nextCursor: end < shown.length ? String(end) : null,
        counts: {
          unseen: shown.filter((n) => n.seenAt === null).length,
          unread: shown.filter((n) => n.readAt === null).length,
        },
      };
    },
    async markRead(notificationId) {
      fake.markReadCalls.push(notificationId);
      fake.all = fake.all.map((n) =>
        n.id === notificationId && n.readAt === null ? { ...n, readAt: now() } : n
      );
    },
    async markAllSeen() {
      fake.markAllSeenCalls++;
      fake.all = fake.all.map((n) => ({ ...n, seenAt: n.seenAt ?? now() }));
    },
    async markAllRead() {
      fake.markAllReadCalls++;
      fake.all = fake.all.map((n) => ({ ...n, readAt: n.readAt ?? now() }));
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    close() {
      fake.closed = true;
      listeners.clear();
    },

    receive(notification) {
      fake.all.push(notification);
      for (const listener of listeners) listener();
    },
    archive(notificationId) {
      fake.archivedIds.add(notificationId);
      for (const listener of listeners) listener();
    },
  };
  return fake;
}
