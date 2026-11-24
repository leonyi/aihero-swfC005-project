import { describe, expect, it } from "vitest";
import type { FeedItem } from "@knocklabs/client";
import {
  FEED_WORKFLOW_KEYS,
  fromKnockFeedItem,
} from "~/lib/notification-feed-knock";
import { KNOCK_WORKFLOWS } from "~/lib/notifications-knock.server";

function knockItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    __cursor: "cursor",
    id: "msg_1",
    actors: [],
    blocks: [],
    inserted_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    read_at: null,
    seen_at: "2026-11-01T09:05:00Z",
    clicked_at: null,
    interacted_at: null,
    link_clicked_at: null,
    archived_at: null,
    total_actors: 0,
    data: null,
    source: { key: "discussion-question", version_id: "v1", categories: [] },
    tenant: null,
    ...overrides,
  };
}

const questionData = {
  courseTitle: "Intro to Testing",
  lessonTitle: "Seams",
  snippet: "What is a seam?",
  commentId: 12,
  url: "/courses/intro/lessons/3#comment-12",
};

describe("fromKnockFeedItem", () => {
  it("reads the kind from the workflow, the sender from the actor and the row data from the trigger data", () => {
    const item = knockItem({
      actors: [
        {
          id: "7",
          name: "Sam Student",
          avatar: "https://example.com/sam.png",
          email: "sam@example.com",
          phone_number: null,
          updated_at: "2026-11-01T09:00:00Z",
          created_at: null,
        },
      ],
      data: questionData,
    });

    expect(fromKnockFeedItem(item)).toEqual({
      id: "msg_1",
      kind: "discussion-question",
      insertedAt: "2026-11-01T09:00:00Z",
      readAt: null,
      seenAt: "2026-11-01T09:05:00Z",
      actor: { name: "Sam Student", avatarUrl: "https://example.com/sam.png" },
      data: questionData,
    });
  });

  it("has no sender for a Notification Cadence itself sent", () => {
    const item = knockItem({
      source: { key: "refund-request-confirmed", version_id: "v1", categories: [] },
      data: { courseTitle: "Intro", amount: 4900, reason: "Not for me", url: null },
    });

    expect(fromKnockFeedItem(item)?.actor).toBeNull();
  });

  it("drops entries from unknown workflows or with data that doesn't fit the kind", () => {
    expect(
      fromKnockFeedItem(
        knockItem({
          source: { key: "prototype-workflow", version_id: "v1", categories: [] },
          data: questionData,
        })
      )
    ).toBeNull();
    expect(fromKnockFeedItem(knockItem({ data: { snippet: "only this" } }))).toBeNull();
  });
});

describe("FEED_WORKFLOW_KEYS", () => {
  it("matches the workflow keys the server triggers", () => {
    for (const [kind, { key }] of Object.entries(KNOCK_WORKFLOWS)) {
      expect(FEED_WORKFLOW_KEYS[kind as keyof typeof KNOCK_WORKFLOWS]).toBe(key);
    }
  });
});
