import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { z } from "zod";
import {
  Bell,
  Check,
  GraduationCap,
  MessageSquare,
  Receipt,
  Settings,
  UsersRound,
} from "lucide-react";
import { UserAvatar } from "~/components/user-avatar";
import { cn, formatRelativeTime } from "~/lib/utils";
import {
  emptyNotificationFeedClient,
  type FeedNotification,
  type NotificationFeedConfig,
} from "~/lib/notification-feed-client";
import { knockNotificationFeedClient } from "~/lib/notification-feed-knock";
import {
  badgeLabel,
  createNotificationFeed,
  describeNotification,
  type FeedCategory,
  type FeedState,
  type NotificationFeed,
} from "~/lib/notification-feed";

// ─── The Notification Feed: a bell in the sidebar header and its popover ───

const configResponseSchema = z.object({
  config: z
    .object({
      userId: z.number(),
      userToken: z.string(),
      publicApiKey: z.string(),
      feedChannelId: z.string(),
    })
    .nullable(),
});

async function fetchFeedConfig(): Promise<NotificationFeedConfig | null> {
  const response = await fetch("/api/notification-feed", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Notification Feed token: ${response.status}`);
  return configResponseSchema.parse(await response.json()).config;
}

/**
 * One feed per signed-in person. Switching user in the DevUI tears it down
 * (closing the socket) and opens the new person's with a fresh token.
 */
function useNotificationFeed(userId: number): NotificationFeed | null {
  const [feed, setFeed] = useState<NotificationFeed | null>(null);

  useEffect(() => {
    let current: NotificationFeed | null = null;
    let cancelled = false;

    async function refreshUserToken() {
      const config = await fetchFeedConfig();
      return config?.userId === userId ? config.userToken : undefined;
    }

    fetchFeedConfig()
      .catch((error) => {
        console.error("[notifications] opening the Notification Feed failed", error);
        return null;
      })
      .then((config) => {
        if (cancelled) return;
        const client =
          config && config.userId === userId
            ? knockNotificationFeedClient(config, refreshUserToken)
            : emptyNotificationFeedClient;
        current = createNotificationFeed(client);
        setFeed(current);
        void current.start();
      });

    return () => {
      cancelled = true;
      current?.stop();
      setFeed(null);
    };
  }, [userId]);

  return feed;
}

const noFeed = {
  subscribe: () => () => {},
  getState: (): FeedState | null => null,
};

function useFeedState(feed: NotificationFeed | null): FeedState | null {
  const source = feed ?? noFeed;
  return useSyncExternalStore(source.subscribe, source.getState, noFeed.getState);
}

export function NotificationBell({ userId }: { userId: number }) {
  const feed = useNotificationFeed(userId);
  const state = useFeedState(feed);
  const [open, setOpen] = useState(false);
  const badge = badgeLabel(state?.unseenCount ?? 0);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void feed?.open();
  }

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-label={badge ? `Notifications, ${badge} unseen` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-md p-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        {badge && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {badge}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <NotificationPopover
            feed={feed}
            state={state}
            close={() => setOpen(false)}
          />
        </>
      )}
    </>
  );
}

const categoryIcon: Record<FeedCategory, React.ReactNode> = {
  discussion: <MessageSquare />,
  refund: <Receipt />,
  team: <UsersRound />,
  enrollment: <GraduationCap />,
};

function NotificationPopover({
  feed,
  state,
  close,
}: {
  feed: NotificationFeed | null;
  state: FeedState | null;
  close: () => void;
}) {
  const navigate = useNavigate();
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const notifications = state?.notifications ?? [];

  // Infinite scroll: reaching the bottom loads the next page by cursor.
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !feed) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void feed.loadMore();
      },
      { root: scroller.current }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [feed]);

  function openRow(notification: FeedNotification) {
    const target = feed?.click(notification.id) ?? null;
    // Nowhere to go (the Refund Request confirmation): it's read, stay open.
    if (target === null) return;
    close();
    navigate(target);
  }

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="fixed left-56 top-2 z-50 ml-2 flex max-h-[calc(100vh-1rem)] w-[26rem] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl"
    >
      <div className="flex items-center gap-3 bg-muted/60 px-4 py-3">
        <span className="font-semibold">Notifications</span>
        <button
          type="button"
          onClick={() => void feed?.markAllRead()}
          disabled={!state || state.unreadCount === 0}
          className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-40 disabled:hover:no-underline"
        >
          Mark all as read
        </button>
        <Link
          to="/settings"
          onClick={close}
          aria-label="Notification settings"
          className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground"
        >
          <Settings className="size-4" />
        </Link>
      </div>
      <div ref={scroller} className="flex-1 overflow-y-auto">
        {notifications.map((notification) => (
          <NotificationRow
            key={notification.id}
            notification={notification}
            onOpen={() => openRow(notification)}
            onMarkRead={() => void feed?.markRead(notification.id)}
          />
        ))}
        {state?.loaded && notifications.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">
            You're all caught up.
          </p>
        )}
        <div
          ref={sentinel}
          className="p-3 text-center text-xs text-muted-foreground"
        >
          {(!state?.loaded || state.loadingMore) && "Loading…"}
        </div>
      </div>
    </div>
  );
}

function NotificationRow({
  notification,
  onOpen,
  onMarkRead,
}: {
  notification: FeedNotification;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const row = describeNotification(notification);
  const read = notification.readAt !== null;
  const sender = notification.actor;

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent">
      <span className={cn("relative shrink-0", read && "opacity-60")}>
        {sender ? (
          <UserAvatar
            name={sender.name}
            avatarUrl={sender.avatarUrl}
            className="size-9"
          />
        ) : (
          // Sent by Cadence itself, e.g. the Refund Request confirmation.
          <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
            C
          </span>
        )}
        <span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-popover text-muted-foreground ring-1 ring-border [&_svg]:size-2.5">
          {categoryIcon[row.category]}
        </span>
      </span>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className={cn("block truncate text-sm", !read && "font-semibold")}>
          {row.title}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {row.snippet} ·{" "}
          <span suppressHydrationWarning>
            {formatRelativeTime(notification.insertedAt)}
          </span>
        </span>
      </button>
      {!read && (
        <button
          type="button"
          onClick={onMarkRead}
          aria-label="Mark as read"
          title="Mark as read"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-background hover:text-primary"
        >
          <Check className="size-4" />
        </button>
      )}
    </div>
  );
}
