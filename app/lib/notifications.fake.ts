import type {
  Notification,
  NotificationPort,
  NotificationUser,
  PreferenceSet,
} from "~/lib/notifications.server";

// ─── In-memory NotificationPort for tests ───
// Records every call so a test can assert who got which Notification. Holds
// preference sets in memory and merges them the way the real port does.

export type FakeNotificationPort = NotificationPort & {
  triggered: Notification[];
  identifiedUsers: NotificationUser[];
  preferenceReads: number[];
  preferences: Map<number, PreferenceSet>;
  archivedCommentIds: number[];
};

export function createFakeNotificationPort(): FakeNotificationPort {
  const fake: FakeNotificationPort = {
    triggered: [],
    identifiedUsers: [],
    preferenceReads: [],
    preferences: new Map(),
    archivedCommentIds: [],

    async trigger(notification) {
      fake.triggered.push(notification);
    },
    async identifyUser(user) {
      fake.identifiedUsers.push(user);
    },
    async getPreferences(userId) {
      fake.preferenceReads.push(userId);
      return fake.preferences.get(userId) ?? null;
    },
    async mergePreferences(userId, changes) {
      const merged: PreferenceSet = { ...fake.preferences.get(userId) };
      for (const [category, channels] of Object.entries(changes)) {
        const key = category as keyof PreferenceSet;
        merged[key] = { ...merged[key], ...channels };
      }
      fake.preferences.set(userId, merged);
    },
    async archiveForComment(commentId) {
      fake.archivedCommentIds.push(commentId);
    },
  };
  return fake;
}

/** A port whose every call fails, as if the vendor were down. */
export function createFailingNotificationPort(
  error = new Error("Notification vendor is down")
): NotificationPort {
  const fail = async () => {
    throw error;
  };
  return {
    trigger: fail,
    identifyUser: fail,
    getPreferences: fail,
    mergePreferences: fail,
    archiveForComment: fail,
  };
}
