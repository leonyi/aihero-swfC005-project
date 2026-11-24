import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules, users } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";
import {
  notify,
  snippetOf,
  type NotificationPort,
  type NotificationUser,
} from "~/lib/notifications.server";

// ─── Comments ───
// Posting and deleting Discussion Questions and Discussion Replies. Both the
// lesson page and the Instructor's questions queue post through here.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory database and a fixed clock. Functions that send Notifications
// take the NotificationPort right after the database. Positional parameters
// (project convention).

type Db = BetterSQLite3Database<typeof schema>;
type Comment = typeof comments.$inferSelect;

export type CommentFailure = { ok: false; status: 400 | 403 | 404; error: string };
export type CommentResult = { ok: true; comment: Comment } | CommentFailure;

function getCommentById(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

type LessonWithCourse = {
  lessonTitle: string;
  courseTitle: string;
  courseSlug: string;
  instructorId: number;
};

function getLessonWithCourse(
  db: Db,
  lessonId: number
): LessonWithCourse | undefined {
  return db
    .select({
      lessonTitle: lessons.title,
      courseTitle: courses.title,
      courseSlug: courses.slug,
      instructorId: courses.instructorId,
    })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

function getNotificationUser(
  db: Db,
  userId: number
): NotificationUser | undefined {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

/**
 * Posts a comment on a lesson: a Discussion Question when `parentId` is null,
 * otherwise a Discussion Reply to the top-level comment it names. A Discussion
 * Question notifies the course's Instructor, unless the Instructor asked it.
 */
export async function createComment(
  db: Db,
  notifications: NotificationPort,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): Promise<CommentResult> {
  const trimmed = body.trim();
  if (trimmed.length < MIN_COMMENT_LENGTH) {
    return { ok: false, status: 400, error: "Comment cannot be empty" };
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    return {
      ok: false,
      status: 400,
      error: `Comment must be ${MAX_COMMENT_LENGTH} characters or fewer`,
    };
  }

  const lesson = getLessonWithCourse(db, lessonId);
  if (!lesson) {
    return { ok: false, status: 404, error: "Lesson not found" };
  }

  if (parentId !== null) {
    const parent = getCommentById(db, parentId);
    if (!parent) {
      return { ok: false, status: 404, error: "Parent comment not found" };
    }
    if (parent.lessonId !== lessonId) {
      return {
        ok: false,
        status: 400,
        error: "Parent comment belongs to a different lesson",
      };
    }
    if (parent.parentId !== null) {
      return {
        ok: false,
        status: 400,
        error: "Replies can only be one level deep",
      };
    }
  }

  const comment = db
    .insert(comments)
    .values({
      userId: authorId,
      lessonId,
      parentId,
      body: trimmed,
      createdAt: now.toISOString(),
    })
    .returning()
    .get();

  if (parentId === null) {
    await notifyDiscussionQuestion(db, notifications, comment, lesson);
  }

  return { ok: true, comment };
}

/** Discussion Question → the course's Instructor, unless they asked it. */
async function notifyDiscussionQuestion(
  db: Db,
  notifications: NotificationPort,
  question: Comment,
  lesson: LessonWithCourse
) {
  if (question.userId === lesson.instructorId) return;
  const instructor = getNotificationUser(db, lesson.instructorId);
  const asker = getNotificationUser(db, question.userId);
  if (!instructor || !asker) return;

  await notify(notifications, {
    kind: "discussion-question",
    recipients: [instructor],
    actor: asker,
    data: {
      courseTitle: lesson.courseTitle,
      lessonTitle: lesson.lessonTitle,
      snippet: snippetOf(question.body),
      url: `/courses/${lesson.courseSlug}/lessons/${question.lessonId}#comment-${question.id}`,
      commentId: question.id,
    },
    idempotencyKey: `discussion-question:${question.id}`,
  });
}

/**
 * Soft-deletes a comment on a lesson. The author may delete their own; staff
 * (the course's Instructor or a Platform Admin) may delete anyone's. A comment
 * on a different lesson is treated as not found, so a route can't reach a
 * comment elsewhere by posting its id. Deleting twice keeps the first time.
 */
export function deleteComment(
  db: Db,
  commentId: number,
  lessonId: number,
  actorId: number,
  isStaff: boolean,
  now: Date
): CommentResult {
  const existing = getCommentById(db, commentId);
  if (!existing || existing.lessonId !== lessonId) {
    return { ok: false, status: 404, error: "Comment not found" };
  }
  if (existing.userId !== actorId && !isStaff) {
    return {
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    };
  }
  if (existing.deletedAt !== null) {
    return { ok: true, comment: existing };
  }

  const comment = db
    .update(comments)
    .set({ deletedAt: now.toISOString() })
    .where(eq(comments.id, commentId))
    .returning()
    .get();

  return { ok: true, comment };
}
