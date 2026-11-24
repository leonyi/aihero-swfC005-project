import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { buyCourse, buyTeamLicence } from "./purchases.server";
import {
  createFailingNotificationPort,
  createFakeNotificationPort,
} from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof createFakeNotificationPort>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotificationPort();
});

function buy(buyerId: number, country: string | null = null, now = NOW) {
  return buyCourse(db, notifications, buyerId, base.course.id, 4900, country, now);
}

/** Buys the course, then has the purchase refunded, leaving the buyer Lapsed. */
async function buyAndRefund(buyerId: number) {
  const first = await buy(buyerId);
  if (!first.ok) throw new Error("first purchase failed");

  const platformAdmin = db
    .insert(schema.users)
    .values({ name: "Pat", email: "pat@example.com", role: UserRole.Admin })
    .returning()
    .get();
  const raised = raiseRefundRequest(
    db,
    first.purchase.id,
    buyerId,
    "Not for me after all",
    NOW
  );
  if (!raised.ok) throw new Error(raised.error);
  approveRefundRequest(db, raised.refundRequestId, platformAdmin.id, null, NOW);
}

describe("buyCourse", () => {
  it("records an Individual Purchase and enrols the buyer", async () => {
    const result = await buy(base.user.id, "US");

    expect(result).toMatchObject({
      ok: true,
      purchase: {
        userId: base.user.id,
        courseId: base.course.id,
        amountPaid: 4900,
        country: "US",
        createdAt: NOW.toISOString(),
      },
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
      },
    });
  });

  it("refuses someone who is already enrolled", async () => {
    await buy(base.user.id);

    expect(await buy(base.user.id)).toEqual({
      ok: false,
      reason: "already_enrolled",
    });
  });

  it("enrols a Lapsed Student again when they buy the course again", async () => {
    await buyAndRefund(base.user.id);

    const later = new Date(2026, 9, 20, 12, 0, 0);
    const again = await buy(base.user.id, null, later);

    expect(again).toMatchObject({
      ok: true,
      purchase: { createdAt: later.toISOString() },
      enrollment: { userId: base.user.id, enrolledAt: later.toISOString() },
    });
  });
});

describe("New Enrollment Notification", () => {
  it("notifies the course's Instructor of an Individual Purchase, with the buyer as sender", async () => {
    const result = await buy(base.user.id);
    if (!result.ok) throw new Error(result.reason);

    expect(notifications.triggered).toEqual([
      {
        kind: "new-enrollment",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: {
          courseTitle: "Test Course",
          url: `/instructor/${base.course.id}/students`,
        },
        idempotencyKey: `new-enrollment:${result.enrollment.id}`,
      },
    ]);
  });

  it("notifies the Instructor again when a Lapsed Student re-enrols", async () => {
    await buyAndRefund(base.user.id);
    notifications.triggered.length = 0;

    const again = await buy(base.user.id);
    if (!again.ok) throw new Error(again.reason);

    expect(notifications.triggered).toMatchObject([
      {
        kind: "new-enrollment",
        recipients: [{ id: base.instructor.id }],
        actor: { id: base.user.id },
        idempotencyKey: `new-enrollment:${again.enrollment.id}`,
      },
    ]);
  });

  it("is not sent when the Instructor buys their own course", async () => {
    await buy(base.instructor.id);

    expect(notifications.triggered).toEqual([]);
  });

  it("is not sent when the purchase is refused", async () => {
    await buy(base.user.id);
    notifications.triggered.length = 0;

    await buy(base.user.id);

    expect(notifications.triggered).toEqual([]);
  });

  it("keeps the purchase when the Notification fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await buyCourse(
      db,
      createFailingNotificationPort(),
      base.user.id,
      base.course.id,
      4900,
      null,
      NOW
    );

    expect(result).toMatchObject({ ok: true });
    expect(db.select().from(schema.purchases).all()).toHaveLength(1);
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe("buyTeamLicence", () => {
  it("records a Team Licence with one Seat per place and makes the buyer its Team Admin", () => {
    const result = buyTeamLicence(
      db,
      base.user.id,
      base.course.id,
      14700,
      "US",
      3,
      NOW
    );

    expect(result.purchase).toMatchObject({
      userId: base.user.id,
      amountPaid: 14700,
      createdAt: NOW.toISOString(),
    });
    expect(result.seats).toHaveLength(3);
    expect(new Set(result.seats.map((seat) => seat.code)).size).toBe(3);
    expect(result.seats[0]).toMatchObject({
      teamId: result.team.id,
      purchaseId: result.purchase.id,
      redeemedAt: null,
    });
  });

  it("does not enrol the buyer, so they can still buy the course for themselves", async () => {
    buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);

    expect(await buy(base.user.id)).toMatchObject({ ok: true });
  });

  it("reuses the buyer's team for a second Team Licence", () => {
    const first = buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);
    const second = buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);

    expect(second.team.id).toBe(first.team.id);
  });
});
