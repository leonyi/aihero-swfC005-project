import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "~/db/schema";
import {
  coupons,
  purchases,
  TeamMemberRole,
  teamMembers,
  UserRole,
  users,
} from "~/db/schema";
import {
  PREFERENCE_CATEGORIES,
  type NotificationPort,
  type PreferenceCategory,
  type PreferenceSet,
} from "~/lib/notifications.server";

// ─── Notification preferences ───
// The Notifications card on /settings. A person sees one switch per preference
// category that applies to what they are or have, not their UserRole alone:
// any role can make a Purchase or run a Team Licence. A switch that isn't
// shown keeps its default.

type Db = BetterSQLite3Database<typeof schema>;

export type PreferenceSwitch = {
  category: PreferenceCategory;
  label: string;
  on: boolean;
};

/** The categories that apply to the person, in the card's order. */
function applicableCategories(db: Db, userId: number): PreferenceCategory[] {
  const user = db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user) return [];

  const hasPurchase =
    db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.userId, userId))
      .limit(1)
      .get() !== undefined;

  const isTeamAdminOnTeamLicence =
    db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .innerJoin(coupons, eq(coupons.teamId, teamMembers.teamId))
      .where(
        and(
          eq(teamMembers.userId, userId),
          eq(teamMembers.role, TeamMemberRole.Admin)
        )
      )
      .limit(1)
      .get() !== undefined;

  const isInstructor = user.role === UserRole.Instructor;

  const applies: Record<PreferenceCategory, boolean> = {
    "refund-request-updates": hasPurchase,
    "open-refund-requests": user.role === UserRole.Admin,
    "seat-claims": isTeamAdminOnTeamLicence,
    enrollments: isInstructor,
    "discussion-questions": isInstructor,
    "discussion-replies": true,
  };
  return (Object.keys(PREFERENCE_CATEGORIES) as PreferenceCategory[]).filter(
    (category) => applies[category]
  );
}

/**
 * The switches the person sees, each at its saved value or, when the person
 * has none saved for it, its default. When the vendor can't be read the
 * switches come back at their defaults with `available: false`, so the card
 * can show them disabled rather than fail the page.
 */
export async function listPreferenceSwitches(
  db: Db,
  notifications: NotificationPort,
  userId: number
): Promise<{ switches: PreferenceSwitch[]; available: boolean }> {
  let saved: PreferenceSet | null = null;
  let available = true;
  try {
    saved = await notifications.getPreferences(userId);
  } catch (error) {
    console.error(`[notifications] read preferences for user ${userId} failed`, error);
    available = false;
  }

  return {
    available,
    switches: applicableCategories(db, userId).map((category) => ({
      category,
      label: PREFERENCE_CATEGORIES[category].label,
      on: saved?.[category]?.feed ?? PREFERENCE_CATEGORIES[category].onByDefault,
    })),
  };
}

export type SetPreferenceResult =
  | { ok: true }
  | { ok: false; status: 403 | 502; error: string };

/**
 * Saves one flipped switch (the feed channel) by merging it into the person's
 * preference set, leaving every other category as it was. Only a category the
 * person can see may be changed. A vendor failure is logged and reported, so
 * the card can tell the person with a toast.
 */
export async function setPreference(
  db: Db,
  notifications: NotificationPort,
  userId: number,
  category: PreferenceCategory,
  on: boolean
): Promise<SetPreferenceResult> {
  if (!applicableCategories(db, userId).includes(category)) {
    return {
      ok: false,
      status: 403,
      error: "That notification setting doesn't apply to you.",
    };
  }
  try {
    await notifications.mergePreferences(userId, { [category]: { feed: on } });
    return { ok: true };
  } catch (error) {
    console.error(
      `[notifications] save ${category} preference for user ${userId} failed`,
      error
    );
    return {
      ok: false,
      status: 502,
      error: "Couldn't save your notification setting. Try again.",
    };
  }
}
