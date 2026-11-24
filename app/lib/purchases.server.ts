import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  enrollments,
  purchases,
  teamMembers,
  teams,
  TeamMemberRole,
} from "~/db/schema";

// ─── Purchases ───
// Buying a course: an Individual Purchase, which enrols the buyer, or a Team
// Licence, which grants Seats and enrols nobody.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory database and a fixed clock. Positional parameters (project
// convention).

type Db = BetterSQLite3Database<typeof schema>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Queryable = Db | Tx;

type Purchase = typeof purchases.$inferSelect;
type Enrollment = typeof enrollments.$inferSelect;
type Team = typeof teams.$inferSelect;
type Seat = typeof coupons.$inferSelect;

export type BuyCourseResult =
  | { ok: true; purchase: Purchase; enrollment: Enrollment }
  | { ok: false; reason: "already_enrolled" };

function isEnrolled(db: Queryable, userId: number, courseId: number) {
  return !!db
    .select({ id: enrollments.id })
    .from(enrollments)
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.courseId, courseId))
    )
    .get();
}

/**
 * Records an Individual Purchase and gives the buyer an Enrollment. A Lapsed
 * Student — one who lost their Enrollment, say to an approved Refund Request —
 * buys again through here and is enrolled again. Someone already enrolled
 * can't buy the course a second time.
 */
export function buyCourse(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  now: Date
): BuyCourseResult {
  return db.transaction((tx): BuyCourseResult => {
    if (isEnrolled(tx, buyerId, courseId)) {
      return { ok: false, reason: "already_enrolled" };
    }

    const purchase = tx
      .insert(purchases)
      .values({
        userId: buyerId,
        courseId,
        amountPaid,
        country,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    const enrollment = tx
      .insert(enrollments)
      .values({ userId: buyerId, courseId, enrolledAt: now.toISOString() })
      .returning()
      .get();

    return { ok: true, purchase, enrollment };
  });
}

function getOrCreateTeamFor(db: Queryable, teamAdminId: number): Team {
  const membership = db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(
      and(
        eq(teamMembers.userId, teamAdminId),
        eq(teamMembers.role, TeamMemberRole.Admin)
      )
    )
    .get();

  const existing = membership
    ? db.select().from(teams).where(eq(teams.id, membership.teamId)).get()
    : undefined;
  if (existing) return existing;

  const team = db.insert(teams).values({}).returning().get();
  db.insert(teamMembers)
    .values({ teamId: team.id, userId: teamAdminId, role: TeamMemberRole.Admin })
    .run();
  return team;
}

export type TeamLicence = { purchase: Purchase; team: Team; seats: Seat[] };

/**
 * Records a Team Licence: a Purchase that grants `seatCount` Seats to the
 * buyer's team, creating the team (with the buyer as its Team Admin) on their
 * first Team Licence. The buyer is not enrolled.
 */
export function buyTeamLicence(
  db: Db,
  buyerId: number,
  courseId: number,
  amountPaid: number,
  country: string | null,
  seatCount: number,
  now: Date
): TeamLicence {
  return db.transaction((tx): TeamLicence => {
    const purchase = tx
      .insert(purchases)
      .values({
        userId: buyerId,
        courseId,
        amountPaid,
        country,
        createdAt: now.toISOString(),
      })
      .returning()
      .get();

    const team = getOrCreateTeamFor(tx, buyerId);

    const seats = Array.from({ length: seatCount }, () =>
      tx
        .insert(coupons)
        .values({
          teamId: team.id,
          courseId,
          code: crypto.randomBytes(12).toString("base64url"),
          purchaseId: purchase.id,
          createdAt: now.toISOString(),
        })
        .returning()
        .get()
    );

    return { purchase, team, seats };
  });
}
