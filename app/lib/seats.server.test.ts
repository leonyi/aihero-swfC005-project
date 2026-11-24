import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { buyCourse, buyTeamLicence } from "./purchases.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { claimSeat, SEAT_ON_HOLD, SEAT_REFUNDED } from "./seats.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  teamAdmin = addPerson("Tess");
});

function addPerson(name: string, role = UserRole.Student) {
  return db
    .insert(schema.users)
    .values({ name, email: `${name.toLowerCase()}@example.com`, role })
    .returning()
    .get();
}

function buySeats(seatCount = 2, country: string | null = "US") {
  return buyTeamLicence(
    db,
    teamAdmin.id,
    base.course.id,
    4900 * seatCount,
    country,
    seatCount,
    NOW
  );
}

describe("claimSeat", () => {
  it("claims an Unclaimed Seat and enrols the person claiming it", () => {
    const { seats } = buySeats();

    const result = claimSeat(db, seats[0].code, base.user.id, "US", NOW);

    expect(result).toMatchObject({
      ok: true,
      seat: {
        id: seats[0].id,
        redeemedByUserId: base.user.id,
        redeemedAt: NOW.toISOString(),
      },
      enrollment: {
        userId: base.user.id,
        courseId: base.course.id,
        enrolledAt: NOW.toISOString(),
      },
    });
  });

  it("refuses a code that matches no Seat", () => {
    expect(claimSeat(db, "nope", base.user.id, "US", NOW)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Claimed Seat", () => {
    const { seats } = buySeats();
    claimSeat(db, seats[0].code, base.user.id, "US", NOW);

    expect(
      claimSeat(db, seats[0].code, addPerson("Sam").id, "US", NOW)
    ).toEqual({ ok: false, error: "Coupon has already been redeemed" });
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", () => {
    const { purchase, seats } = buySeats();
    raiseRefundRequest(db, purchase.id, teamAdmin.id, "Team changed plans", NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "US", NOW)).toEqual({
      ok: false,
      error: SEAT_ON_HOLD,
    });
  });

  it("refuses a Seat whose Team Licence was refunded", () => {
    const { purchase, seats } = buySeats();
    const platformAdmin = addPerson("Pat", UserRole.Admin);
    const raised = raiseRefundRequest(
      db,
      purchase.id,
      teamAdmin.id,
      "Team changed plans",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);
    approveRefundRequest(db, raised.refundRequestId, platformAdmin.id, null, NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "US", NOW)).toEqual({
      ok: false,
      error: SEAT_REFUNDED,
    });
  });

  it("refuses someone already enrolled on the course, leaving the Seat unclaimed", () => {
    const { seats } = buySeats();
    buyCourse(db, base.user.id, base.course.id, 4900, "US", NOW);

    expect(claimSeat(db, seats[0].code, base.user.id, "US", NOW)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(
      claimSeat(db, seats[0].code, addPerson("Sam").id, "US", NOW)
    ).toMatchObject({ ok: true });
  });

  it("refuses a claim from a different country than the Team Licence was bought in", () => {
    const { seats } = buySeats(2, "US");

    expect(claimSeat(db, seats[0].code, base.user.id, "IN", NOW)).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });

  it("lets anyone claim a Seat on a Team Licence bought with no country", () => {
    const { seats } = buySeats(2, null);

    expect(
      claimSeat(db, seats[0].code, base.user.id, "IN", NOW)
    ).toMatchObject({ ok: true });
  });
});
