import { and, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { coupons, courses, enrollments, purchases } from "~/db/schema";
import { notifyNewEnrollment } from "~/lib/enrollment-notifications.server";
import {
  getNotificationUser,
  notify,
  type NotificationPort,
} from "~/lib/notifications.server";
import { getSeatAvailability } from "~/lib/refunds.server";

// ─── Seats ───
// Claiming a Seat on a Team Licence: the person redeeming its code gets an
// Enrollment and the Seat becomes a Claimed Seat.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory database and a fixed clock. Functions that send Notifications
// take the NotificationPort right after the database. Positional parameters
// (project convention).

type Db = BetterSQLite3Database<typeof schema>;
type Seat = typeof coupons.$inferSelect;
type Enrollment = typeof enrollments.$inferSelect;

export const SEAT_ON_HOLD =
  "This seat can't be claimed right now. Ask the person who shared it with you.";

export const SEAT_REFUNDED =
  "This seat is no longer available. Ask the person who shared it with you.";

export type ClaimSeatResult =
  | { ok: true; seat: Seat; enrollment: Enrollment }
  | { ok: false; error: string };

/**
 * Claims the Seat with this code for `claimantId` and enrols them. Refused when
 * the Seat is already claimed, on hold or refunded, when the claimant is
 * already enrolled, or when the Team Licence was bought from a different
 * country than the claimant is in.
 *
 * A claim sends Seat claimed to the Team Admin who owns the Team Licence and
 * New Enrollment to the course's Instructor.
 */
export async function claimSeat(
  db: Db,
  notifications: NotificationPort,
  code: string,
  claimantId: number,
  claimantCountry: string,
  now: Date
): Promise<ClaimSeatResult> {
  const result = db.transaction((tx): ClaimSeatResult => {
    const seat = tx.select().from(coupons).where(eq(coupons.code, code)).get();
    if (!seat) {
      return { ok: false, error: "Coupon not found" };
    }

    if (seat.redeemedByUserId !== null) {
      return { ok: false, error: "Coupon has already been redeemed" };
    }

    const availability = getSeatAvailability(tx, seat);
    if (availability === "on_hold") {
      return { ok: false, error: SEAT_ON_HOLD };
    }
    if (availability === "refunded") {
      return { ok: false, error: SEAT_REFUNDED };
    }

    const existingEnrollment = tx
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, claimantId),
          eq(enrollments.courseId, seat.courseId)
        )
      )
      .get();
    if (existingEnrollment) {
      return { ok: false, error: "You are already enrolled in this course" };
    }

    const teamLicence = tx
      .select({ country: purchases.country })
      .from(purchases)
      .where(eq(purchases.id, seat.purchaseId))
      .get();
    if (teamLicence?.country && teamLicence.country !== claimantCountry) {
      return {
        ok: false,
        error:
          "This coupon can only be redeemed from the same country as the purchaser",
      };
    }

    const claimed = tx
      .update(coupons)
      .set({ redeemedByUserId: claimantId, redeemedAt: now.toISOString() })
      .where(eq(coupons.id, seat.id))
      .returning()
      .get();

    const enrollment = tx
      .insert(enrollments)
      .values({
        userId: claimantId,
        courseId: seat.courseId,
        enrolledAt: now.toISOString(),
      })
      .returning()
      .get();

    return { ok: true, seat: claimed, enrollment };
  });

  if (result.ok) {
    await notifySeatClaimed(db, notifications, result.seat);
    await notifyNewEnrollment(db, notifications, result.enrollment);
  }
  return result;
}

/** Unclaimed Seats on the Team Licence that can still be claimed. */
function countSeatsLeft(db: Db, purchaseId: number): number {
  return db
    .select({ id: coupons.id })
    .from(coupons)
    .where(
      and(
        eq(coupons.purchaseId, purchaseId),
        isNull(coupons.redeemedByUserId),
        isNull(coupons.refundedAt)
      )
    )
    .all().length;
}

/**
 * Seat claimed → the Team Admin who bought the Team Licence, unless they
 * claimed the Seat themselves.
 */
async function notifySeatClaimed(
  db: Db,
  notifications: NotificationPort,
  seat: Seat
) {
  const teamLicence = db
    .select({ buyerId: purchases.userId, courseTitle: courses.title })
    .from(purchases)
    .innerJoin(courses, eq(purchases.courseId, courses.id))
    .where(eq(purchases.id, seat.purchaseId))
    .get();
  if (!teamLicence || seat.redeemedByUserId === null) return;
  if (seat.redeemedByUserId === teamLicence.buyerId) return;

  const teamAdmin = getNotificationUser(db, teamLicence.buyerId);
  const claimant = getNotificationUser(db, seat.redeemedByUserId);
  if (!teamAdmin || !claimant) return;

  await notify(notifications, {
    kind: "seat-claimed",
    recipients: [teamAdmin],
    actor: claimant,
    data: {
      courseTitle: teamLicence.courseTitle,
      seatsLeft: countSeatsLeft(db, seat.purchaseId),
      url: "/team",
    },
    idempotencyKey: `seat-claimed:${seat.id}`,
  });
}
