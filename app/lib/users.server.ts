import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import { UserRole, users } from "~/db/schema";
import {
  bestEffort,
  PREFERENCE_CATEGORIES,
  type NotificationPort,
  type NotificationUser,
  type PreferenceCategory,
  type PreferenceSet,
} from "~/lib/notifications.server";

// ─── Users ───
// Creating and editing people, and keeping the Notification vendor's copy of
// them (name, email, avatar) in step so they show correctly in other people's
// Notification Feeds.
//
// Functions take the database first and the NotificationPort right after it.
// Positional parameters (project convention).

type Db = BetterSQLite3Database<typeof schema>;
type User = typeof users.$inferSelect;

/** Every category's feed channel at its default: on, except Enrollments. */
export function defaultPreferences(): PreferenceSet {
  const preferences: PreferenceSet = {};
  for (const category of Object.keys(
    PREFERENCE_CATEGORIES
  ) as PreferenceCategory[]) {
    preferences[category] = { feed: PREFERENCE_CATEGORIES[category].onByDefault };
  }
  return preferences;
}

/**
 * Sends the person's name, email and avatar to the vendor, and writes the
 * default preferences only if they have none yet, so re-syncing never
 * overwrites their choices. Best effort: a failure is logged, never thrown.
 */
export function syncUser(
  notifications: NotificationPort,
  user: NotificationUser
): Promise<void> {
  return bestEffort(`sync user ${user.id}`, async () => {
    await notifications.identifyUser(user);
    const existing = await notifications.getPreferences(user.id);
    if (existing === null) {
      await notifications.mergePreferences(user.id, defaultPreferences());
    }
  });
}

function toNotificationUser(user: User): NotificationUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
  };
}

/**
 * Signs a person up as a Student and syncs them. An email Cadence already
 * knows returns that person instead (`created: false`) and syncs nothing.
 */
export async function signUp(
  db: Db,
  notifications: NotificationPort,
  name: string,
  email: string
): Promise<{ user: User; created: boolean }> {
  const existing = db.select().from(users).where(eq(users.email, email)).get();
  if (existing) return { user: existing, created: false };

  const user = db
    .insert(users)
    .values({ name, email, role: UserRole.Student, avatarUrl: null })
    .returning()
    .get();
  await syncUser(notifications, toNotificationUser(user));
  return { user, created: true };
}

/**
 * Saves a person's own name and bio from `/settings`. A changed name is synced;
 * the bio isn't sent to the vendor. Undefined when there is no such person.
 */
export async function updateProfile(
  db: Db,
  notifications: NotificationPort,
  userId: number,
  name: string,
  bio: string | null
): Promise<User | undefined> {
  const before = db.select().from(users).where(eq(users.id, userId)).get();
  if (!before) return undefined;

  const user = db
    .update(users)
    .set({ name, bio })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user && user.name !== before.name) {
    await syncUser(notifications, toNotificationUser(user));
  }
  return user;
}

/**
 * Saves the name and email a Platform Admin set for a person, and syncs them.
 * Undefined when there is no such person.
 */
export async function adminUpdateUser(
  db: Db,
  notifications: NotificationPort,
  userId: number,
  name: string,
  email: string
): Promise<User | undefined> {
  const user = db
    .update(users)
    .set({ name, email })
    .where(eq(users.id, userId))
    .returning()
    .get();
  if (user) await syncUser(notifications, toNotificationUser(user));
  return user;
}

/**
 * Syncs every person, one at a time, for the seed and the one-off backfill.
 * Safe to re-run: defaults are only written for people who have none, and a
 * failure for one person is logged and skipped.
 */
export async function syncAllUsers(
  db: Db,
  notifications: NotificationPort
): Promise<void> {
  const everyone = db.select().from(users).orderBy(users.id).all();
  for (const user of everyone) {
    await syncUser(notifications, toNotificationUser(user));
  }
}
