import type { NotificationKind } from "~/lib/notifications.server";

// ─── Knock workflows ───
// The Knock workflow each Notification kind is sent through. Shared by the
// server adapter (notifications-knock.server.ts), which triggers them, and the
// browser feed adapter (notification-feed-knock.ts), which maps a feed entry's
// workflow back to its kind. Not server-only, so both can import it.

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
