import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import { createComment, deleteComment } from "./comments.server";
import {
  createFailingNotificationPort,
  createFakeNotificationPort,
} from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

const NOW = new Date(2026, 9, 6, 12, 0, 0);

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof createFakeNotificationPort>;
let lessonId: number;
let otherLessonId: number;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotificationPort();

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

function post(
  authorId: number,
  onLesson: number,
  parentId: number | null,
  body: string
) {
  return createComment(
    db,
    notifications,
    authorId,
    onLesson,
    parentId,
    body,
    NOW
  );
}

async function postQuestion(authorId = base.user.id, onLesson = lessonId) {
  const result = await post(authorId, onLesson, null, "A question");
  if (!result.ok) throw new Error(result.error);
  return result.comment;
}

describe("createComment", () => {
  it("posts a Discussion Question on a lesson, trimmed and stamped with now", async () => {
    const result = await post(base.user.id, lessonId, null, "  How do I start?  ");

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

  it("posts a Discussion Reply under a Discussion Question", async () => {
    const question = await postQuestion();

    const result = await post(
      base.instructor.id,
      lessonId,
      question.id,
      "Start with lesson one."
    );

    expect(result).toMatchObject({
      ok: true,
      comment: { userId: base.instructor.id, parentId: question.id },
    });
  });

  it("refuses an empty comment", async () => {
    expect(await post(base.user.id, lessonId, null, "   ")).toEqual({
      ok: false,
      status: 400,
      error: "Comment cannot be empty",
    });
  });

  it("refuses a comment over the length limit", async () => {
    const result = await post(base.user.id, lessonId, null, "x".repeat(5001));
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a comment on a lesson that does not exist", async () => {
    expect(await post(base.user.id, 9999, null, "Hi")).toEqual({
      ok: false,
      status: 404,
      error: "Lesson not found",
    });
  });

  it("refuses a reply to a reply, since replies are one level deep", async () => {
    const question = await postQuestion();
    const reply = await post(base.user.id, lessonId, question.id, "R");
    if (!reply.ok) throw new Error(reply.error);

    expect(await post(base.user.id, lessonId, reply.comment.id, "R2")).toEqual({
      ok: false,
      status: 400,
      error: "Replies can only be one level deep",
    });
  });

  it("refuses a reply to a question on a different lesson", async () => {
    const question = await postQuestion(base.user.id, otherLessonId);

    expect(
      await post(base.user.id, lessonId, question.id, "R")
    ).toMatchObject({ ok: false, status: 400 });
  });
});

describe("deleteComment", () => {
  it("lets the author soft-delete their own comment, stamped with now", async () => {
    const question = await postQuestion();

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

  it("lets staff delete someone else's comment", async () => {
    const question = await postQuestion();

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

  it("refuses someone else's comment to a non-staff person", async () => {
    const question = await postQuestion(base.instructor.id);

    expect(
      deleteComment(db, question.id, lessonId, base.user.id, false, NOW)
    ).toEqual({
      ok: false,
      status: 403,
      error: "You can only delete your own comments",
    });
  });

  it("treats a comment on another lesson as not found", async () => {
    const question = await postQuestion(base.user.id, otherLessonId);

    expect(
      deleteComment(db, question.id, lessonId, base.user.id, false, NOW)
    ).toEqual({ ok: false, status: 404, error: "Comment not found" });
  });

  it("keeps the first deletion time when a comment is deleted twice", async () => {
    const question = await postQuestion();
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

describe("Discussion Question Notification", () => {
  it("notifies the course's Instructor, with the Student as sender", async () => {
    const result = await post(
      base.user.id,
      lessonId,
      null,
      "How do I install the toolchain?"
    );
    if (!result.ok) throw new Error(result.error);
    const commentId = result.comment.id;

    expect(notifications.triggered).toEqual([
      {
        kind: "discussion-question",
        recipients: [
          {
            id: base.instructor.id,
            name: "Test Instructor",
            email: "instructor@example.com",
            avatarUrl: null,
          },
        ],
        actor: {
          id: base.user.id,
          name: "Test User",
          email: "test@example.com",
          avatarUrl: null,
        },
        data: {
          courseTitle: "Test Course",
          lessonTitle: "Lesson 1",
          snippet: "How do I install the toolchain?",
          url: `/courses/test-course/lessons/${lessonId}#comment-${commentId}`,
          commentId,
        },
        idempotencyKey: `discussion-question:${commentId}`,
      },
    ]);
  });

  it("sends nothing when the Instructor asks on their own course", async () => {
    await postQuestion(base.instructor.id);

    expect(notifications.triggered).toEqual([]);
  });

  it("notifies the Instructor when a Platform Admin asks", async () => {
    const admin = db
      .insert(schema.users)
      .values({
        name: "Platform Admin",
        email: "admin@example.com",
        role: schema.UserRole.Admin,
      })
      .returning()
      .get();

    await postQuestion(admin.id);

    expect(notifications.triggered).toMatchObject([
      {
        kind: "discussion-question",
        recipients: [{ id: base.instructor.id }],
        actor: { id: admin.id },
      },
    ]);
  });

  it("is not sent for a Discussion Reply", async () => {
    const question = await postQuestion();
    notifications.triggered.length = 0;

    await post(base.user.id, lessonId, question.id, "Never mind, solved it.");

    expect(notifications.triggered).toEqual([]);
  });

  it("cuts a long question down to a one-line snippet", async () => {
    await post(base.user.id, lessonId, null, `First line\n\n${"word ".repeat(60)}`);

    const [sent] = notifications.triggered;
    if (sent?.kind !== "discussion-question") throw new Error("not sent");
    expect(sent.data.snippet).toHaveLength(140);
    expect(sent.data.snippet).toMatch(/^First line word word .*…$/);
  });

  it("keeps the question posted when the Notification fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await createComment(
      db,
      createFailingNotificationPort(),
      base.user.id,
      lessonId,
      null,
      "Is anyone there?",
      NOW
    );

    expect(result).toMatchObject({ ok: true, comment: { body: "Is anyone there?" } });
    const saved = db.select().from(schema.comments).all();
    expect(saved).toHaveLength(1);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});
