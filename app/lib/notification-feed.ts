import type {
  FeedNotification,
  FeedPage,
  NotificationFeedClient,
} from "~/lib/notification-feed-client";
import { formatPrice } from "~/lib/utils";

// ─── Notification Feed state ───
// What the bell and the popover show, kept in step with a
// NotificationFeedClient. Framework-free: React reads it through
// `subscribe`/`getState` (useSyncExternalStore).

export type FeedState = {
  /** Every Notification loaded so far, newest first. */
  notifications: FeedNotification[];
  unseenCount: number;
  unreadCount: number;
  /** Whether older Notifications are still to load. */
  hasMore: boolean;
  loadingMore: boolean;
  /** Whether the first page has arrived. */
  loaded: boolean;
};

/** The bell's red badge: null when nothing is unseen, capped at "9+". */
export function badgeLabel(unseenCount: number): string | null {
  if (unseenCount <= 0) return null;
  return unseenCount > 9 ? "9+" : String(unseenCount);
}

// ─── Rows ───
// A row's text comes from the Notification's trigger data, not the vendor's
// templates.

/** The small icon on the sender's avatar. */
export type FeedCategory = "discussion" | "refund" | "team" | "enrollment";

export type FeedRow = {
  category: FeedCategory;
  title: string;
  /** One line: a snippet or context. */
  snippet: string;
};

const quote = (text: string) => `“${text}”`;

export function describeNotification(notification: FeedNotification): FeedRow {
  const sender = notification.actor?.name ?? "Someone";
  switch (notification.kind) {
    case "discussion-question":
      return {
        category: "discussion",
        title: `${sender} asked a question`,
        snippet: `${quote(notification.data.snippet)} · ${notification.data.lessonTitle}`,
      };
    case "discussion-reply":
      return {
        category: "discussion",
        title: `${sender} replied to your question`,
        snippet: `${quote(notification.data.snippet)} · ${notification.data.lessonTitle}`,
      };
    case "new-enrollment":
      return {
        category: "enrollment",
        title: `${sender} enrolled`,
        snippet: notification.data.courseTitle,
      };
    case "seat-claimed": {
      const left = notification.data.seatsLeft;
      return {
        category: "team",
        title: `${sender} claimed a Seat`,
        snippet: `${notification.data.courseTitle} · ${left} ${left === 1 ? "Seat" : "Seats"} left`,
      };
    }
    case "open-refund-request":
      return {
        category: "refund",
        title: `${sender} requested a ${formatPrice(notification.data.amount)} refund`,
        snippet: `${notification.data.courseTitle} · ${quote(notification.data.reason)}`,
      };
    case "refund-request-confirmed":
      return {
        category: "refund",
        title: "We've received your Refund Request",
        snippet: `${notification.data.courseTitle} · A Platform Admin will review it.`,
      };
    case "refund-request-approved": {
      const note = notification.data.decisionNote;
      return {
        category: "refund",
        title: "Your Refund Request was approved",
        snippet: note
          ? `${notification.data.courseTitle} · ${quote(note)}`
          : `${notification.data.courseTitle} · ${formatPrice(notification.data.amount)} is on its way.`,
      };
    }
    case "refund-request-declined": {
      const note = notification.data.decisionNote;
      return {
        category: "refund",
        title: "Your Refund Request was declined",
        snippet: `${notification.data.courseTitle} · ${note ? `${quote(note)} ` : ""}You can ask again.`,
      };
    }
  }
}

// ─── State ───

export type NotificationFeed = ReturnType<typeof createNotificationFeed>;

export function createNotificationFeed(client: NotificationFeedClient) {
  let state: FeedState = {
    notifications: [],
    unseenCount: 0,
    unreadCount: 0,
    hasMore: false,
    loadingMore: false,
    loaded: false,
  };
  let nextCursor: string | null = null;
  let stopped = false;
  let unsubscribeFromClient: (() => void) | null = null;
  // Bumped by every reload, so a slower, older answer never overwrites it.
  let generation = 0;
  const listeners = new Set<() => void>();

  function setState(changes: Partial<FeedState>) {
    state = { ...state, ...changes };
    for (const listener of listeners) listener();
  }

  async function fetchPage(cursor: string | null): Promise<FeedPage | null> {
    try {
      return await client.list(cursor);
    } catch (error) {
      console.error("[notifications] loading the Notification Feed failed", error);
      return null;
    }
  }

  /**
   * Reloads from the newest down to at least as far back as is loaded now,
   * so new arrivals appear, older pages stay, and archived Notifications
   * disappear wherever they were.
   */
  async function reload() {
    const mine = ++generation;
    const oldestLoaded = state.notifications.at(-1)?.insertedAt ?? null;
    const collected: FeedNotification[] = [];
    let cursor: string | null = null;
    let last: FeedPage | null = null;
    do {
      const page = await fetchPage(cursor);
      if (!page || stopped || mine !== generation) return;
      collected.push(...page.notifications);
      cursor = page.nextCursor;
      last = page;
    } while (
      cursor !== null &&
      oldestLoaded !== null &&
      (collected.at(-1)?.insertedAt ?? "") > oldestLoaded
    );

    nextCursor = cursor;
    setState({
      notifications: merge([], collected),
      unseenCount: last.counts.unseen,
      unreadCount: last.counts.unread,
      hasMore: nextCursor !== null,
      loadingMore: false,
      loaded: true,
    });
  }

  const feed = {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Loads the first page and follows live updates until `stop`. */
    async start() {
      unsubscribeFromClient = client.subscribe(() => {
        void reload();
      });
      await reload();
      if (!state.loaded && !stopped) setState({ loaded: true });
    },

    /** Stops following live updates and disconnects the client. */
    stop() {
      stopped = true;
      unsubscribeFromClient?.();
      client.close();
    },

    /** Loads the next older page, if there is one and none is loading. */
    async loadMore() {
      if (nextCursor === null || state.loadingMore) return;
      const mine = generation;
      setState({ loadingMore: true });
      const page = await fetchPage(nextCursor);
      if (stopped) return;
      if (!page || mine !== generation) return setState({ loadingMore: false });
      nextCursor = page.nextCursor;
      setState({
        notifications: merge(state.notifications, page.notifications),
        unseenCount: page.counts.unseen,
        unreadCount: page.counts.unread,
        hasMore: nextCursor !== null,
        loadingMore: false,
      });
    },

    /**
     * The popover opened: everything is seen, loaded or not. Seen is not
     * read, so the unread count stays. Also reloads, to drop Notifications
     * archived since, which the vendor may not push live.
     */
    async open() {
      markLoadedSeen();
      await reload();
      markLoadedSeen();
      await attempt("marking all seen", () => client.markAllSeen());
    },

    async markRead(notificationId: string) {
      const notification = state.notifications.find((n) => n.id === notificationId);
      if (!notification || notification.readAt !== null) return;
      const readAt = new Date().toISOString();
      setState({
        notifications: state.notifications.map((n) =>
          n.id === notificationId ? { ...n, readAt } : n
        ),
        unreadCount: Math.max(0, state.unreadCount - 1),
      });
      await attempt("marking read", () => client.markRead(notificationId));
    },

    /** Every Notification is read, loaded or not. */
    async markAllRead() {
      const readAt = new Date().toISOString();
      setState({
        notifications: state.notifications.map((n) => ({
          ...n,
          readAt: n.readAt ?? readAt,
        })),
        unreadCount: 0,
      });
      await attempt("marking all read", () => client.markAllRead());
    },

    /**
     * A row was clicked: it is read. Returns where to go, the most specific
     * place there is, or null when there is nowhere to go.
     */
    click(notificationId: string): string | null {
      const notification = state.notifications.find((n) => n.id === notificationId);
      if (!notification) return null;
      void feed.markRead(notificationId);
      return notification.data.url;
    },
  };
  return feed;

  function markLoadedSeen() {
    const seenAt = new Date().toISOString();
    setState({
      notifications: state.notifications.map((n) => ({
        ...n,
        seenAt: n.seenAt ?? seenAt,
      })),
      unseenCount: 0,
    });
  }
}

/** The optimistic state stays; the next load from the vendor corrects it. */
async function attempt(what: string, work: () => Promise<void>) {
  try {
    await work();
  } catch (error) {
    console.error(`[notifications] ${what} failed`, error);
  }
}

/** Both lists, newest first, the incoming copy winning on the same id. */
function merge(current: FeedNotification[], incoming: FeedNotification[]) {
  const byId = new Map(current.map((n) => [n.id, n]));
  for (const n of incoming) byId.set(n.id, n);
  return newestFirst([...byId.values()]);
}

function newestFirst(notifications: FeedNotification[]) {
  return [...notifications].sort(
    (a, b) => b.insertedAt.localeCompare(a.insertedAt) || b.id.localeCompare(a.id)
  );
}
