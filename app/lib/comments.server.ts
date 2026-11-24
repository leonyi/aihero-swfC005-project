import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { comments, courses, lessons, modules } from "~/db/schema";
import { MAX_COMMENT_LENGTH, MIN_COMMENT_LENGTH } from "~/lib/comments";

// ─── Comments ───
// Posting and deleting Discussion Questions and Discussion Replies. Both the
// lesson page and the Instructor's questions queue post through here.
//
// Every function takes the database first and `now` last, so tests can hand in
// an in-memory database and a fixed clock. Positional parameters (project
// convention).

type Db = BetterSQLite3Database<typeof schema>;
type Comment = typeof comments.$inferSelect;

export type CommentFailure = { ok: false; status: 400 | 403 | 404; error: string };
export type CommentResult = { ok: true; comment: Comment } | CommentFailure;

function getCommentById(db: Db, commentId: number) {
  return db.select().from(comments).where(eq(comments.id, commentId)).get();
}

function lessonExists(db: Db, lessonId: number) {
  return !!db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(lessons.id, lessonId))
    .get();
}

/**
 * Posts a comment on a lesson: a Discussion Question when `parentId` is null,
 * otherwise a Discussion Reply to the top-level comment it names.
 */
export function createComment(
  db: Db,
  authorId: number,
  lessonId: number,
  parentId: number | null,
  body: string,
  now: Date
): CommentResult {
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

  if (!lessonExists(db, lessonId)) {
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

  return { ok: true, comment };
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
