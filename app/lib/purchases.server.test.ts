import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { buyCourse, buyTeamLicence } from "./purchases.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
});

describe("buyCourse", () => {
  it("records an Individual Purchase and enrols the buyer", () => {
    const result = buyCourse(db, base.user.id, base.course.id, 4900, "US", NOW);

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

  it("refuses someone who is already enrolled", () => {
    buyCourse(db, base.user.id, base.course.id, 4900, null, NOW);

    expect(
      buyCourse(db, base.user.id, base.course.id, 4900, null, NOW)
    ).toEqual({ ok: false, reason: "already_enrolled" });
  });

  it("enrols a Lapsed Student again when they buy the course again", () => {
    const first = buyCourse(db, base.user.id, base.course.id, 4900, null, NOW);
    if (!first.ok) throw new Error("first purchase failed");

    const platformAdmin = db
      .insert(schema.users)
      .values({ name: "Pat", email: "pat@example.com", role: UserRole.Admin })
      .returning()
      .get();
    const raised = raiseRefundRequest(
      db,
      first.purchase.id,
      base.user.id,
      "Not for me after all",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);
    approveRefundRequest(db, raised.refundRequestId, platformAdmin.id, null, NOW);

    const later = new Date(2026, 9, 20, 12, 0, 0);
    const again = buyCourse(db, base.user.id, base.course.id, 4900, null, later);

    expect(again).toMatchObject({
      ok: true,
      purchase: { createdAt: later.toISOString() },
      enrollment: { userId: base.user.id, enrolledAt: later.toISOString() },
    });
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

  it("does not enrol the buyer, so they can still buy the course for themselves", () => {
    buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);

    expect(
      buyCourse(db, base.user.id, base.course.id, 4900, null, NOW)
    ).toMatchObject({ ok: true });
  });

  it("reuses the buyer's team for a second Team Licence", () => {
    const first = buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);
    const second = buyTeamLicence(db, base.user.id, base.course.id, 4900, null, 1, NOW);

    expect(second.team.id).toBe(first.team.id);
  });
});
