import { describe, expect, it, vi } from "vitest";
import {
  emptyNotificationFeedClient,
  type FeedNotification,
} from "~/lib/notification-feed-client";
import { createFakeNotificationFeedClient } from "~/lib/notification-feed.fake";
import {
  badgeLabel,
  createNotificationFeed,
  describeNotification,
} from "~/lib/notification-feed";

// Minutes after a fixed start, so "newer" is a later timestamp.
function at(minute: number) {
  return new Date(Date.UTC(2026, 10, 1, 9, minute)).toISOString();
}

function question(
  id: string,
  minute: number,
  overrides: Partial<{ readAt: string | null; seenAt: string | null }> = {}
): FeedNotification {
  return {
    id,
    kind: "discussion-question",
    insertedAt: at(minute),
    readAt: null,
    seenAt: null,
    actor: { name: "Sam Student", avatarUrl: null },
    data: {
      courseTitle: "Intro to Testing",
      lessonTitle: "Seams",
      snippet: "What is a seam?",
      commentId: Number(id.replace(/\D/g, "")),
      url: `/courses/intro/lessons/1#comment-${id}`,
    },
    ...overrides,
  };
}

function confirmation(id: string, minute: number): FeedNotification {
  return {
    id,
    kind: "refund-request-confirmed",
    insertedAt: at(minute),
    readAt: null,
    seenAt: null,
    actor: null,
    data: {
      courseTitle: "Intro to Testing",
      amount: 4900,
      reason: "Not for me",
      url: null,
    },
  };
}

function ids(feed: ReturnType<typeof createNotificationFeed>) {
  return feed.getState().notifications.map((n) => n.id);
}

describe("badgeLabel", () => {
  it("shows nothing when there is nothing unseen", () => {
    expect(badgeLabel(0)).toBeNull();
  });

  it("shows the unseen count up to 9", () => {
    expect(badgeLabel(1)).toBe("1");
    expect(badgeLabel(9)).toBe("9");
  });

  it("caps at 9+", () => {
    expect(badgeLabel(10)).toBe("9+");
    expect(badgeLabel(250)).toBe("9+");
  });
});

describe("createNotificationFeed", () => {
  it("loads the first page newest first, with the counts", async () => {
    const client = createFakeNotificationFeedClient([
      question("q1", 1),
      question("q3", 3, { seenAt: at(4) }),
      question("q2", 2, { readAt: at(5), seenAt: at(5) }),
    ]);
    const feed = createNotificationFeed(client);

    await feed.start();

    expect(ids(feed)).toEqual(["q3", "q2", "q1"]);
    expect(feed.getState()).toMatchObject({
      unseenCount: 1,
      unreadCount: 2,
      hasMore: false,
      loaded: true,
    });
  });
});

describe("describeNotification", () => {
  it("says who asked, where, and quotes the question", () => {
    expect(describeNotification(question("q1", 1))).toEqual({
      category: "discussion",
      title: "Sam Student asked a question",
      snippet: "“What is a seam?” · Seams",
    });
  });

  it("describes a system Notification without a sender", () => {
    expect(describeNotification(confirmation("r1", 1))).toEqual({
      category: "refund",
      title: "We've received your Refund Request",
      snippet: "Intro to Testing · A Platform Admin will review it.",
    });
  });

  it("says how many Seats are left", () => {
    const claimed: FeedNotification = {
      id: "s1",
      kind: "seat-claimed",
      insertedAt: at(1),
      readAt: null,
      seenAt: null,
      actor: { name: "Tia Teammate", avatarUrl: null },
      data: { courseTitle: "Intro to Testing", seatsLeft: 1, url: "/team" },
    };
    expect(describeNotification(claimed)).toEqual({
      category: "team",
      title: "Tia Teammate claimed a Seat",
      snippet: "Intro to Testing · 1 Seat left",
    });
  });

  it("gives the amount of an Open Refund Request and its reason", () => {
    const open: FeedNotification = {
      ...confirmation("r2", 1),
      kind: "open-refund-request",
      actor: { name: "Sam Student", avatarUrl: null },
      data: { courseTitle: "Intro to Testing", amount: 4900, reason: "Not for me", url: "/admin/refunds" },
    };
    expect(describeNotification(open)).toEqual({
      category: "refund",
      title: "Sam Student requested a $49.00 refund",
      snippet: "Intro to Testing · “Not for me”",
    });
  });
});

describe("without Knock keys", () => {
  it("shows the empty state and no badge", async () => {
    const feed = createNotificationFeed(emptyNotificationFeedClient);

    await feed.start();
    await feed.open();

    expect(feed.getState()).toMatchObject({
      notifications: [],
      unseenCount: 0,
      unreadCount: 0,
      hasMore: false,
      loaded: true,
    });
  });
});

describe("a client that fails", () => {
  it("still finishes loading, empty", async () => {
    const client = createFakeNotificationFeedClient();
    client.list = async () => {
      throw new Error("429 rate_limited");
    };
    const feed = createNotificationFeed(client);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await feed.start();

    expect(feed.getState()).toMatchObject({ notifications: [], loaded: true });
    error.mockRestore();
  });
});

describe("paging", () => {
  it("loads older pages by cursor until there are none, keeping history", async () => {
    const all = Array.from({ length: 5 }, (_, i) => question(`q${i + 1}`, i + 1));
    const client = createFakeNotificationFeedClient(all, 2);
    const feed = createNotificationFeed(client);

    await feed.start();
    expect(ids(feed)).toEqual(["q5", "q4"]);
    expect(feed.getState().hasMore).toBe(true);

    await feed.loadMore();
    await feed.loadMore();

    expect(ids(feed)).toEqual(["q5", "q4", "q3", "q2", "q1"]);
    expect(feed.getState().hasMore).toBe(false);
    expect(client.listCalls).toEqual([null, "2", "4"]);

    await feed.loadMore();
    expect(client.listCalls).toHaveLength(3);
  });
});

// Lets the feed finish the refresh a live update starts.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("live updates", () => {
  it("shows a new Notification and bumps the badge without reloading", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    client.receive(question("q2", 2));
    await settle();

    expect(ids(feed)).toEqual(["q2", "q1"]);
    expect(feed.getState().unseenCount).toBe(2);
  });

  it("keeps older pages loaded when a new Notification arrives", async () => {
    const all = Array.from({ length: 4 }, (_, i) => question(`q${i + 1}`, i + 1));
    const client = createFakeNotificationFeedClient(all, 2);
    const feed = createNotificationFeed(client);
    await feed.start();
    await feed.loadMore();

    client.receive(question("q5", 5));
    await settle();

    expect(ids(feed)).toEqual(["q5", "q4", "q3", "q2", "q1"]);
    expect(feed.getState().hasMore).toBe(false);
  });

  it("stops listening once stopped, and closes the client", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    feed.stop();
    expect(client.closed).toBe(true);
    client.receive(question("q2", 2));
    await settle();

    expect(ids(feed)).toEqual(["q1"]);
  });
});

describe("removing rows", () => {
  it("removes a Notification that was archived", async () => {
    const client = createFakeNotificationFeedClient([
      question("q1", 1),
      question("q2", 2),
      question("q3", 3),
    ]);
    const feed = createNotificationFeed(client);
    await feed.start();

    client.archive("q2");
    await settle();

    expect(ids(feed)).toEqual(["q3", "q1"]);
    expect(feed.getState().unreadCount).toBe(2);
  });

  it("removes an archived Notification on the next open when nothing was pushed", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1), question("q2", 2)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    client.archivedIds.add("q1");
    await feed.open();

    expect(ids(feed)).toEqual(["q2"]);
    expect(feed.getState().unseenCount).toBe(0);
  });

  it("removes an archived Notification from an older page", async () => {
    const all = Array.from({ length: 4 }, (_, i) => question(`q${i + 1}`, i + 1));
    const client = createFakeNotificationFeedClient(all, 2);
    const feed = createNotificationFeed(client);
    await feed.start();
    await feed.loadMore();

    client.archive("q1");
    await settle();

    expect(ids(feed)).toEqual(["q4", "q3", "q2"]);
  });

  it("shows the empty state once the last one is gone", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    client.archive("q1");
    await settle();

    expect(feed.getState().notifications).toEqual([]);
  });
});

describe("clicking a row", () => {
  it("marks it read and goes to the exact comment", async () => {
    const client = createFakeNotificationFeedClient([question("q7", 1)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    const target = feed.click("q7");

    expect(target).toBe("/courses/intro/lessons/1#comment-q7");
    expect(feed.getState().unreadCount).toBe(0);
    expect(client.markReadCalls).toEqual(["q7"]);
  });

  it("marks it read and goes nowhere when there is nowhere to go", async () => {
    const client = createFakeNotificationFeedClient([confirmation("r1", 1)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    expect(feed.click("r1")).toBeNull();
    expect(feed.getState().notifications[0]?.readAt).not.toBeNull();
  });
});

describe("seen and read", () => {
  it("opening marks everything seen, loaded or not, and clears the badge but not unread", async () => {
    const all = Array.from({ length: 12 }, (_, i) => question(`q${i + 1}`, i + 1));
    const client = createFakeNotificationFeedClient(all, 5);
    const feed = createNotificationFeed(client);
    await feed.start();
    expect(badgeLabel(feed.getState().unseenCount)).toBe("9+");

    const opening = feed.open();
    expect(feed.getState().unseenCount).toBe(0);
    await opening;

    expect(client.markAllSeenCalls).toBe(1);
    expect(feed.getState().unseenCount).toBe(0);
    expect(feed.getState().unreadCount).toBe(12);
    expect(feed.getState().notifications.every((n) => n.seenAt !== null)).toBe(true);
    expect(feed.getState().notifications.every((n) => n.readAt === null)).toBe(true);
    // Unloaded Notifications were marked seen too.
    expect((await client.list("10")).notifications.every((n) => n.seenAt)).toBe(true);
  });

  it("marks one Notification read", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1), question("q2", 2)]);
    const feed = createNotificationFeed(client);
    await feed.start();

    await feed.markRead("q1");

    expect(client.markReadCalls).toEqual(["q1"]);
    expect(feed.getState().unreadCount).toBe(1);
    expect(feed.getState().notifications.find((n) => n.id === "q1")?.readAt).not.toBeNull();
    expect(feed.getState().notifications.find((n) => n.id === "q2")?.readAt).toBeNull();
  });

  it("does not mark an already read Notification again", async () => {
    const client = createFakeNotificationFeedClient([question("q1", 1, { readAt: at(2) })]);
    const feed = createNotificationFeed(client);
    await feed.start();

    await feed.markRead("q1");

    expect(client.markReadCalls).toEqual([]);
    expect(feed.getState().unreadCount).toBe(0);
  });

  it("marks all read, loaded or not", async () => {
    const all = Array.from({ length: 4 }, (_, i) => question(`q${i + 1}`, i + 1));
    const client = createFakeNotificationFeedClient(all, 2);
    const feed = createNotificationFeed(client);
    await feed.start();

    await feed.markAllRead();

    expect(client.markAllReadCalls).toBe(1);
    expect(feed.getState().unreadCount).toBe(0);
    expect(feed.getState().notifications.every((n) => n.readAt !== null)).toBe(true);
    await feed.loadMore();
    expect(feed.getState().notifications.every((n) => n.readAt !== null)).toBe(true);
  });
});
