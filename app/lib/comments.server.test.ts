import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);

  const module = db
    .insert(schema.modules)
    .values({ courseId: base.course.id, title: "Basics", position: 1 })
    .returning()
    .get();

  lessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 1", position: 1 })
    .returning()
    .get().id;

  otherLessonId = db
    .insert(schema.lessons)
    .values({ moduleId: module.id, title: "Lesson 2", position: 2 })
    .returning()
    .get().id;
});

function postQuestion(authorId = base.user.id, onLesson = lessonId) {
  const result = createComment(db, authorId, onLesson, null, "A question", NOW);
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

describe("createComment", () => {
  it("posts a Discussion Question on a lesson, trimmed and stamped with now", () => {
    const result = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "  How do I start?  ",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: {
        userId: base.user.id,
        lessonId,
        parentId: null,
        body: "How do I start?",
        createdAt: NOW.toISOString(),
      },
    });
  });

  it("posts a Discussion Reply under a Discussion Question", () => {
    const question = postQuestion();

    const result = createComment(
      db,
      base.instructor.id,
      lessonId,
      question.id,
      "Start with lesson one.",
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { userId: base.instructor.id, parentId: question.id },
    });
  });

  it("refuses an empty comment", () => {
    expect(createComment(db, base.user.id, lessonId, null, "   ", NOW)).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses a comment over the length limit", () => {
    const result = createComment(
      db,
      base.user.id,
      lessonId,
      null,
      "x".repeat(5001),
      NOW
    );
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a comment on a lesson that does not exist", () => {
    expect(createComment(db, base.user.id, 9999, null, "Hi", NOW)).toEqual({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });

  it("refuses a reply to a reply, since replies are one level deep", () => {
    const question = postQuestion();
    const reply = createComment(db, base.user.id, lessonId, question.id, "R", NOW);
    if (!reply.ok) throw new Error(reply.error);

    expect(
      createComment(db, base.user.id, lessonId, reply.comment.id, "R2", NOW)
    ).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a reply to a question on a different lesson", () => {
    const question = postQuestion(base.user.id, otherLessonId);

    expect(
      createComment(db, base.user.id, lessonId, question.id, "R", NOW)
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe("deleteComment", () => {
  it("lets the author soft-delete their own comment, stamped with now", () => {
    const question = postQuestion();

    const result = deleteComment(
      db,
      question.id,
      lessonId,
      base.user.id,
      false,
      NOW
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { id: question.id, deletedAt: NOW.toISOString() },
    });
  });

  it("lets staff delete someone else's comment", () => {
    const question = postQuestion();

    const result = deleteComment(
      db,
      question.id,
      lessonId,
      base.instructor.id,
      true,
      NOW
    );

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses someone else's comment to a non-staff person", () => {
    const question = postQuestion(base.instructor.id);

    expect(
      deleteComment(db, question.id, lessonId, base.user.id, false, NOW)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
  });

  it("treats a comment on another lesson as not found", () => {
    const question = postQuestion(base.user.id, otherLessonId);

    expect(
      deleteComment(db, question.id, lessonId, base.user.id, false, NOW)
    ).toEqual({ ok: false, status: 404, error: "Comment not found" });
  });

  it("keeps the first deletion time when a comment is deleted twice", () => {
    const question = postQuestion();
    deleteComment(db, question.id, lessonId, base.user.id, false, NOW);

    const later = new Date(NOW.getTime() + 60_000);
    const result = deleteComment(
      db,
      question.id,
      lessonId,
      base.user.id,
      false,
      later
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { deletedAt: NOW.toISOString() },
    });
  });
});
