import { describe, it, expect } from "vitest";
import {
  fromKnockPreferences,
  knockWorkflowDefinitions,
  toKnockPreferences,
  toKnockTrigger,
} from "./notifications-knock.server";

// Cadence's names → Knock's keys. No test here calls Knock.

describe("toKnockTrigger", () => {
  it("maps a Discussion Question to its workflow, with string user ids and avatar", () => {
    expect(
      toKnockTrigger({
        kind: "discussion-question",
        recipients: [
          { id: 2, name: "Ines", email: "ines@example.com", avatarUrl: null },
        ],
        actor: {
          id: 7,
          name: "Sam",
          email: "sam@example.com",
          avatarUrl: "https://example.com/sam.png",
        },
        data: {
          courseTitle: "Rust",
          lessonTitle: "Ownership",
          snippet: "Why move?",
          url: "/courses/rust/lessons/3#comment-9",
          commentId: 9,
        },
        idempotencyKey: "discussion-question:9",
      })
    ).toEqual({
      workflowKey: "discussion-question",
      body: {
        recipients: [
          { id: "2", name: "Ines", email: "ines@example.com", avatar: null },
        ],
        actor: {
          id: "7",
          name: "Sam",
          email: "sam@example.com",
          avatar: "https://example.com/sam.png",
        },
        data: {
          courseTitle: "Rust",
          lessonTitle: "Ownership",
          snippet: "Why move?",
          url: "/courses/rust/lessons/3#comment-9",
          commentId: 9,
        },
      },
      idempotencyKey: "discussion-question:9",
    });
  });

  it("leaves out the actor for a Notification Cadence sends itself", () => {
    const trigger = toKnockTrigger({
      kind: "refund-request-confirmed",
      recipients: [{ id: 2, name: "Ines", email: "i@example.com", avatarUrl: null }],
      actor: null,
      data: { courseTitle: "Rust", amount: 4900, reason: "Too hard", url: null },
      idempotencyKey: "refund-request-confirmed:4",
    });

    expect(trigger.workflowKey).toBe("refund-request-confirmed");
    expect(trigger.body).not.toHaveProperty("actor");
  });
});

describe("Knock preferences", () => {
  it("writes a Cadence category × feed change as Knock category × in-app feed", () => {
    expect(
      toKnockPreferences({
        enrollments: { feed: false },
        "discussion-questions": { feed: true },
      })
    ).toEqual({
      enrollment: { channel_types: { in_app_feed: false } },
      discussion_questions: { channel_types: { in_app_feed: true } },
    });
  });

  it("only sends the categories that changed, so a merge leaves the rest alone", () => {
    expect(Object.keys(toKnockPreferences({ "seat-claims": { feed: false } }))).toEqual([
      "seat_claims",
    ]);
  });

  it("reads Knock's set back into Cadence's names, skipping keys Cadence doesn't know", () => {
    expect(
      fromKnockPreferences({
        id: "default",
        categories: {
          enrollment: { channel_types: { in_app_feed: false } },
          refund_request_updates: true,
          open_refund_requests: { channel_types: {} },
          discussion: { channel_types: { in_app_feed: true } },
        },
      })
    ).toEqual({
      enrollments: { feed: false },
      "refund-request-updates": { feed: true },
      "open-refund-requests": {},
    });
  });

  it("treats a set with no categories as no preferences yet", () => {
    expect(fromKnockPreferences({ id: "default", categories: null })).toBeNull();
    expect(fromKnockPreferences({ id: "default", categories: {} })).toBeNull();
  });
});

describe("knockWorkflowDefinitions", () => {
  it("defines one in-app feed workflow per Notification kind, in its category", () => {
    const definitions = knockWorkflowDefinitions("cadence-feed");

    expect(
      definitions.map((d) => [d.key, d.workflow.categories])
    ).toEqual([
      ["refund-request-confirmed", ["refund_request_updates"]],
      ["refund-request-approved", ["refund_request_updates"]],
      ["refund-request-declined", ["refund_request_updates"]],
      ["open-refund-request", ["open_refund_requests"]],
      ["seat-claimed", ["seat_claims"]],
      ["new-enrollment", ["enrollment"]],
      ["discussion-question", ["discussion_questions"]],
      ["discussion-reply", ["discussion_replies"]],
    ]);
    for (const { workflow } of definitions) {
      expect(workflow.steps).toEqual([
        expect.objectContaining({
          ref: "in_app_feed_1",
          type: "channel",
          channel_key: "cadence-feed",
        }),
      ]);
    }
  });
});
