import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import {
  listPreferenceSwitches,
  setPreference,
} from "./notification-preferences.server";
import {
  createFailingNotificationPort,
  createFakeNotificationPort,
} from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof createFakeNotificationPort>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotificationPort();
});

async function visibleLabels(userId: number) {
  const { switches } = await listPreferenceSwitches(db, notifications, userId);
  return switches.map((s) => s.label);
}

describe("listPreferenceSwitches", () => {
  it("shows a Student with nothing only Discussion Replies", async () => {
    expect(await visibleLabels(base.user.id)).toEqual(["Discussion Replies"]);
  });

  it("adds Refund Request updates once the person has a Purchase", async () => {
    db.insert(schema.purchases)
      .values({ userId: base.user.id, courseId: base.course.id, amountPaid: 4900 })
      .run();

    expect(await visibleLabels(base.user.id)).toEqual([
      "Refund Request updates",
      "Discussion Replies",
    ]);
  });

  it("adds Seat claims for a Team Admin on a Team Licence, whatever their role", async () => {
    const teamAdmin = db
      .insert(schema.users)
      .values({
        name: "Team Admin",
        email: "team-admin@example.com",
        role: schema.UserRole.Instructor,
      })
      .returning()
      .get();
    const purchase = db
      .insert(schema.purchases)
      .values({ userId: teamAdmin.id, courseId: base.course.id, amountPaid: 9900 })
      .returning()
      .get();
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: teamAdmin.id,
        role: schema.TeamMemberRole.Admin,
      })
      .run();
    db.insert(schema.coupons)
      .values({
        teamId: team.id,
        courseId: base.course.id,
        code: "SEAT-1",
        purchaseId: purchase.id,
      })
      .run();

    expect(await visibleLabels(teamAdmin.id)).toEqual([
      "Refund Request updates",
      "Seat claims",
      "Enrollments",
      "Discussion Questions",
      "Discussion Replies",
    ]);
  });

  it("doesn't show Seat claims to a mere member of a team", async () => {
    const team = db.insert(schema.teams).values({}).returning().get();
    db.insert(schema.teamMembers)
      .values({
        teamId: team.id,
        userId: base.user.id,
        role: schema.TeamMemberRole.Member,
      })
      .run();

    expect(await visibleLabels(base.user.id)).toEqual(["Discussion Replies"]);
  });

  it("shows an Instructor Enrollments and Discussion Questions", async () => {
    expect(await visibleLabels(base.instructor.id)).toEqual([
      "Enrollments",
      "Discussion Questions",
      "Discussion Replies",
    ]);
  });

  it("shows a Platform Admin Open Refund Requests", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    expect(await visibleLabels(admin.id)).toEqual([
      "Open Refund Requests",
      "Discussion Replies",
    ]);
  });
});

describe("switch values", () => {
  it("shows each switch at the person's saved value", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
      "discussion-questions": { feed: false },
      "discussion-replies": { feed: true },
    });

    const { switches, available } = await listPreferenceSwitches(
      db,
      notifications,
      base.instructor.id
    );

    expect(available).toBe(true);
    expect(switches).toEqual([
      { category: "enrollments", label: "Enrollments", on: true },
      { category: "discussion-questions", label: "Discussion Questions", on: false },
      { category: "discussion-replies", label: "Discussion Replies", on: true },
    ]);
  });

  it("shows a newly applicable switch at its default", async () => {
    // Synced before becoming an Instructor: no Enrollments or Discussion
    // Questions setting saved yet.
    notifications.preferences.set(base.instructor.id, {
      "discussion-replies": { feed: false },
    });

    const { switches } = await listPreferenceSwitches(
      db,
      notifications,
      base.instructor.id
    );

    expect(switches.map((s) => [s.category, s.on])).toEqual([
      ["enrollments", false],
      ["discussion-questions", true],
      ["discussion-replies", false],
    ]);
  });

  it("marks the switches unavailable when the vendor can't be read", async () => {
    const { switches, available } = await listPreferenceSwitches(
      db,
      createFailingNotificationPort(),
      base.user.id
    );

    expect(available).toBe(false);
    expect(switches.map((s) => s.category)).toEqual(["discussion-replies"]);
  });
});

describe("setPreference", () => {
  it("merges one flip into the set and leaves the others untouched", async () => {
    notifications.preferences.set(base.instructor.id, {
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: false },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: true },
    });

    const result = await setPreference(
      db,
      notifications,
      base.instructor.id,
      "enrollments",
      true
    );

    expect(result).toEqual({ ok: true });
    expect(notifications.preferences.get(base.instructor.id)).toEqual({
      "refund-request-updates": { feed: true },
      "open-refund-requests": { feed: true },
      "seat-claims": { feed: true },
      enrollments: { feed: true },
      "discussion-questions": { feed: true },
      "discussion-replies": { feed: true },
    });
  });

  it("turns a category off", async () => {
    await setPreference(db, notifications, base.user.id, "discussion-replies", false);

    const { switches } = await listPreferenceSwitches(db, notifications, base.user.id);
    expect(switches).toEqual([
      { category: "discussion-replies", label: "Discussion Replies", on: false },
    ]);
  });

  it("refuses a category that doesn't apply to the person", async () => {
    const result = await setPreference(
      db,
      notifications,
      base.user.id,
      "open-refund-requests",
      false
    );

    expect(result).toEqual({ ok: false, reason: "not-applicable" });
    expect(notifications.preferences.get(base.user.id)).toBeUndefined();
  });

  it("reports a failed save when the vendor is down", async () => {
    const result = await setPreference(
      db,
      createFailingNotificationPort(),
      base.user.id,
      "discussion-replies",
      false
    );

    expect(result).toEqual({ ok: false, reason: "save-failed" });
  });
});
