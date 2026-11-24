import { describe, it, expect } from "vitest";
import { loggingNotificationPort } from "./notifications.server";

describe("loggingNotificationPort", () => {
  it("logs a Notification instead of sending it, for dev without Knock keys", async () => {
    const lines: string[] = [];
    const port = loggingNotificationPort((line) => lines.push(line));

    await port.trigger({
      kind: "discussion-question",
      recipients: [{ id: 2, name: "Ines", email: "i@example.com", avatarUrl: null }],
      actor: null,
      data: {
        courseTitle: "Rust",
        lessonTitle: "Ownership",
        snippet: "Why move?",
        url: null,
        commentId: 9,
      },
      idempotencyKey: "discussion-question:9",
    });

    expect(lines).toEqual([
      expect.stringContaining("discussion-question → users 2 (discussion-question:9)"),
    ]);
  });

  it("reports no preferences, so nothing reads as already set", async () => {
    expect(await loggingNotificationPort(() => {}).getPreferences(2)).toBeNull();
  });
});
