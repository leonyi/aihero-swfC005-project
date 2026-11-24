import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { courses, enrollments } from "~/db/schema";
import {
  getNotificationUser,
  notify,
  type NotificationPort,
} from "~/lib/notifications.server";

// ─── New Enrollment Notification ───
// Every way into a course ends in an Enrollment: an Individual Purchase, a
// Lapsed Student buying again, or a Claimed Seat. Each tells the course's
// Instructor, with the newly enrolled person as sender. A Team Licence enrols
// nobody, so it sends nothing.

type Db = BetterSQLite3Database<typeof schema>;
type Enrollment = typeof enrollments.$inferSelect;

/**
 * New Enrollment → the course's Instructor, unless they enrolled themselves.
 * Call after the Enrollment commits.
 */
export async function notifyNewEnrollment(
  db: Db,
  notifications: NotificationPort,
  enrollment: Enrollment
): Promise<void> {
  const course = db
    .select({ title: courses.title, instructorId: courses.instructorId })
    .from(courses)
    .where(eq(courses.id, enrollment.courseId))
    .get();
  if (!course || course.instructorId === enrollment.userId) return;
  const instructor = getNotificationUser(db, course.instructorId);
  const student = getNotificationUser(db, enrollment.userId);
  if (!instructor || !student) return;

  await notify(notifications, {
    kind: "new-enrollment",
    recipients: [instructor],
    actor: student,
    data: {
      courseTitle: course.title,
      url: `/instructor/${enrollment.courseId}/students`,
    },
    idempotencyKey: `new-enrollment:${enrollment.id}`,
  });
}
