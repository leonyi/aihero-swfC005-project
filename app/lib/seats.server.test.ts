import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { UserRole } from "~/db/schema";
import { buyCourse, buyTeamLicence } from "./purchases.server";
import { approveRefundRequest, raiseRefundRequest } from "./refunds.server";
import { claimSeat, SEAT_ON_HOLD, SEAT_REFUNDED } from "./seats.server";
import {
  createFailingNotificationPort,
  createFakeNotificationPort,
} from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof createFakeNotificationPort>;
let teamAdmin: typeof schema.users.$inferSelect;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotificationPort();
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

function claim(code: string, claimantId: number, country = "US") {
  return claimSeat(db, notifications, code, claimantId, country, NOW);
}

describe("claimSeat", () => {
  it("claims an Unclaimed Seat and enrols the person claiming it", async () => {
    const { seats } = buySeats();

    const result = await claim(seats[0].code, base.user.id);

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

  it("refuses a code that matches no Seat", async () => {
    expect(await claim("nope", base.user.id)).toEqual({
      ok: false,
      error: "Coupon not found",
    });
  });

  it("refuses a Claimed Seat", async () => {
    const { seats } = buySeats();
    await claim(seats[0].code, base.user.id);

    expect(await claim(seats[0].code, addPerson("Sam").id)).toEqual({
      ok: false,
      error: "Coupon has already been redeemed",
    });
  });

  it("refuses a Seat on hold while its Team Licence has an Open Refund Request", async () => {
    const { purchase, seats } = buySeats();
    await raiseRefundRequest(db, notifications, purchase.id, teamAdmin.id, "Team changed plans", NOW);

    expect(await claim(seats[0].code, base.user.id)).toEqual({
      ok: false,
      error: SEAT_ON_HOLD,
    });
  });

  it("refuses a Seat whose Team Licence was refunded", async () => {
    const { purchase, seats } = buySeats();
    const platformAdmin = addPerson("Pat", UserRole.Admin);
    const raised = await raiseRefundRequest(
      db,
      notifications,
      purchase.id,
      teamAdmin.id,
      "Team changed plans",
      NOW
    );
    if (!raised.ok) throw new Error(raised.error);
    await approveRefundRequest(db, notifications, raised.refundRequestId, platformAdmin.id, null, NOW);

    expect(await claim(seats[0].code, base.user.id)).toEqual({
      ok: false,
      error: SEAT_REFUNDED,
    });
  });

  it("refuses someone already enrolled on the course, leaving the Seat unclaimed", async () => {
    const { seats } = buySeats();
    await buyCourse(db, notifications, base.user.id, base.course.id, 4900, "US", NOW);

    expect(await claim(seats[0].code, base.user.id)).toEqual({
      ok: false,
      error: "You are already enrolled in this course",
    });
    expect(await claim(seats[0].code, addPerson("Sam").id)).toMatchObject({
      ok: true,
    });
  });

  it("refuses a claim from a different country than the Team Licence was bought in", async () => {
    const { seats } = buySeats(2, "US");

    expect(await claim(seats[0].code, base.user.id, "IN")).toEqual({
      ok: false,
      error:
        "This coupon can only be redeemed from the same country as the purchaser",
    });
  });

  it("lets anyone claim a Seat on a Team Licence bought with no country", async () => {
    const { seats } = buySeats(2, null);

    expect(await claim(seats[0].code, base.user.id, "IN")).toMatchObject({
      ok: true,
    });
  });
});

describe("Notifications on a Seat claim", () => {
  it("tells the owning Team Admin who claimed which course, with the Seats left", async () => {
    const { seats } = buySeats(3);

    const result = await claim(seats[0].code, base.user.id);
    if (!result.ok) throw new Error(result.error);

    const seatClaimed = notifications.triggered.filter(
      (n) => n.kind === "seat-claimed"
    );
    expect(seatClaimed).toEqual([
      {
        kind: "seat-claimed",
        recipients: [
          {
            id: teamAdmin.id,
            name: "Tess",
            email: "tess@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: { courseTitle: "Test Course", seatsLeft: 2, url: "/team" },
        idempotencyKey: `seat-claimed:${seats[0].id}`,
      },
    ]);
  });

  it("counts down the Seats left as more are claimed", async () => {
    const { seats } = buySeats(2);

    await claim(seats[0].code, base.user.id);
    await claim(seats[1].code, addPerson("Sam").id);

    expect(
      notifications.triggered.flatMap((n) =>
        n.kind === "seat-claimed" ? [n.data.seatsLeft] : []
      )
    ).toEqual([1, 0]);
  });

  it("tells the course's Instructor of the New Enrollment", async () => {
    const { seats } = buySeats();

    const result = await claim(seats[0].code, base.user.id);
    if (!result.ok) throw new Error(result.error);

    expect(
      notifications.triggered.filter((n) => n.kind === "new-enrollment")
    ).toMatchObject([
      {
        recipients: [{ id: base.instructor.id }],
        actor: { id: base.user.id },
        data: { courseTitle: "Test Course" },
        idempotencyKey: `new-enrollment:${result.enrollment.id}`,
      },
    ]);
  });

  it("sends no Seat claimed when the Team Admin claims a Seat themselves", async () => {
    const { seats } = buySeats();

    await claim(seats[0].code, teamAdmin.id);

    expect(notifications.triggered.map((n) => n.kind)).toEqual([
      "new-enrollment",
    ]);
  });

  it("sends nothing when the claim is refused", async () => {
    await claim("nope", base.user.id);

    expect(notifications.triggered).toEqual([]);
  });

  it("buying a Team Licence sends nothing, since nobody has enrolled yet", () => {
    buySeats(3);

    expect(notifications.triggered).toEqual([]);
  });

  it("keeps the claim when the Notifications fail", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { seats } = buySeats();

    const result = await claimSeat(
      db,
      createFailingNotificationPort(),
      seats[0].code,
      base.user.id,
      "US",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      seat: { redeemedByUserId: base.user.id },
    });
    expect(db.select().from(schema.enrollments).all()).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
