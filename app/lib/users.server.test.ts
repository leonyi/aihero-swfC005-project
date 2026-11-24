import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, seedBaseData } from "~/test/setup";
import * as schema from "~/db/schema";
import type { NotificationUser } from "./notifications.server";
import {
  adminUpdateUser,
  signUp,
  syncAllUsers,
  syncUser,
  updateProfile,
} from "./users.server";
import {
  createFailingNotificationPort,
  createFakeNotificationPort,
} from "./notifications.fake";

type TestDb = ReturnType<typeof createTestDb>;

const DEFAULT_PREFERENCES = {
  "refund-request-updates": { feed: true },
  "open-refund-requests": { feed: true },
  "seat-claims": { feed: true },
  enrollments: { feed: false },
  "discussion-questions": { feed: true },
  "discussion-replies": { feed: true },
};

let db: TestDb;
let base: ReturnType<typeof seedBaseData>;
let notifications: ReturnType<typeof createFakeNotificationPort>;

beforeEach(() => {
  db = createTestDb();
  base = seedBaseData(db);
  notifications = createFakeNotificationPort();
});

describe("syncUser", () => {
  it("identifies the person and writes the default preferences when they have none", async () => {
    await syncUser(notifications, {
      id: base.user.id,
      name: "Test User",
      email: "test@example.com",
      avatarUrl: "https://example.com/a.png",
    });

    expect(notifications.identifiedUsers).toEqual([
      {
        id: base.user.id,
        name: "Test User",
        email: "test@example.com",
        avatarUrl: "https://example.com/a.png",
      },
    ]);
    expect(notifications.preferences.get(base.user.id)).toEqual(
      DEFAULT_PREFERENCES
    );
  });

  it("leaves the person's existing preferences untouched", async () => {
    notifications.preferences.set(base.instructor.id, {
      enrollments: { feed: true },
      "discussion-questions": { feed: false },
    });

    await syncUser(notifications, {
      id: base.instructor.id,
      name: "Test Instructor",
      email: "instructor@example.com",
      avatarUrl: null,
    });

    expect(notifications.identifiedUsers).toHaveLength(1);
    expect(notifications.preferences.get(base.instructor.id)).toEqual({
      enrollments: { feed: true },
      "discussion-questions": { feed: false },
    });
  });

  it("never throws when the Notification vendor is down", async () => {
    await expect(
      syncUser(createFailingNotificationPort(), {
        id: base.user.id,
        name: "Test User",
        email: "test@example.com",
        avatarUrl: null,
      })
    ).resolves.toBeUndefined();
  });
});

describe("signUp", () => {
  it("creates a Student and syncs them with the default preferences", async () => {
    const result = await signUp(db, notifications, "New Person", "new@example.com");

    expect(result.created).toBe(true);
    expect(result.user).toMatchObject({
      name: "New Person",
      email: "new@example.com",
      role: schema.UserRole.Student,
    });
    expect(notifications.identifiedUsers).toEqual([
      { id: result.user.id, name: "New Person", email: "new@example.com", avatarUrl: null },
    ]);
    expect(notifications.preferences.get(result.user.id)).toEqual(
      DEFAULT_PREFERENCES
    );
  });

  it("returns the existing person for a known email without syncing", async () => {
    const result = await signUp(db, notifications, "Someone", "test@example.com");

    expect(result.created).toBe(false);
    expect(result.user.id).toBe(base.user.id);
    expect(notifications.identifiedUsers).toEqual([]);
  });

  it("still creates the person when the Notification vendor is down", async () => {
    const result = await signUp(
      db,
      createFailingNotificationPort(),
      "New Person",
      "new@example.com"
    );
    expect(result.created).toBe(true);

    const again = await signUp(db, notifications, "New Person", "new@example.com");
    expect(again).toMatchObject({ created: false, user: { id: result.user.id } });
  });
});

describe("updateProfile", () => {
  it("saves a new name and syncs the person", async () => {
    const user = await updateProfile(db, notifications, base.user.id, "Renamed", "Hello");

    expect(user).toMatchObject({ name: "Renamed", bio: "Hello", email: "test@example.com" });
    expect(notifications.identifiedUsers).toEqual([
      { id: base.user.id, name: "Renamed", email: "test@example.com", avatarUrl: null },
    ]);
  });

  it("does not sync when only the bio changes", async () => {
    const user = await updateProfile(db, notifications, base.user.id, "Test User", "New bio");

    expect(user).toMatchObject({ name: "Test User", bio: "New bio" });
    expect(notifications.identifiedUsers).toEqual([]);
  });

  it("still saves the name when the Notification vendor is down", async () => {
    const user = await updateProfile(
      db,
      createFailingNotificationPort(),
      base.user.id,
      "Renamed",
      null
    );

    expect(user).toMatchObject({ name: "Renamed", bio: null });
  });
});

describe("adminUpdateUser", () => {
  it("saves the name and email a Platform Admin set and syncs the person", async () => {
    notifications.preferences.set(base.user.id, { enrollments: { feed: true } });

    const user = await adminUpdateUser(
      db,
      notifications,
      base.user.id,
      "Edited",
      "edited@example.com"
    );

    expect(user).toMatchObject({ name: "Edited", email: "edited@example.com" });
    expect(notifications.identifiedUsers).toEqual([
      { id: base.user.id, name: "Edited", email: "edited@example.com", avatarUrl: null },
    ]);
    expect(notifications.preferences.get(base.user.id)).toEqual({
      enrollments: { feed: true },
    });
  });

  it("still saves the edit when the Notification vendor is down", async () => {
    const user = await adminUpdateUser(
      db,
      createFailingNotificationPort(),
      base.user.id,
      "Edited",
      "edited@example.com"
    );

    expect(user).toMatchObject({ name: "Edited", email: "edited@example.com" });
  });
});

describe("syncAllUsers", () => {
  it("syncs every person and is safe to re-run", async () => {
    await syncAllUsers(db, notifications);
    notifications.preferences.set(base.instructor.id, {
      ...DEFAULT_PREFERENCES,
      enrollments: { feed: true },
    });
    await syncAllUsers(db, notifications);

    expect(notifications.identifiedUsers.map((u) => u.id)).toEqual([
      base.user.id,
      base.instructor.id,
      base.user.id,
      base.instructor.id,
    ]);
    expect(notifications.preferences.get(base.user.id)).toEqual(
      DEFAULT_PREFERENCES
    );
    expect(notifications.preferences.get(base.instructor.id)).toEqual({
      ...DEFAULT_PREFERENCES,
      enrollments: { feed: true },
    });
  });

  it("keeps going past a person whose sync fails", async () => {
    const failsForFirstUser = {
      ...notifications,
      async identifyUser(user: NotificationUser) {
        if (user.id === base.user.id) throw new Error("Vendor rejected user");
        await notifications.identifyUser(user);
      },
    };

    await syncAllUsers(db, failsForFirstUser);

    expect(notifications.identifiedUsers.map((u) => u.id)).toEqual([
      base.instructor.id,
    ]);
    expect(notifications.preferences.get(base.instructor.id)).toEqual(
      DEFAULT_PREFERENCES
    );
  });
});
