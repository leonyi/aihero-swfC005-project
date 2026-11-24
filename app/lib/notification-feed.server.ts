import { signUserToken } from "@knocklabs/node";
import type { NotificationFeedConfig } from "~/lib/notification-feed-client";
import { loadEnvForNotifications } from "~/lib/notification-port.server";

// ─── Opening a person's Notification Feed ───
// The browser reads the feed straight from Knock with the public key and a
// user token signed here (RS256, `sub` = the Cadence user id). Knock rejects
// that token on anyone else's feed (403).

const TOKEN_LIFETIME_SECONDS = 60 * 60;

type FeedEnv = {
  KNOCK_PUBLIC_API_KEY?: string;
  KNOCK_SIGNING_KEY?: string;
  KNOCK_FEED_CHANNEL_ID?: string;
};

function currentEnv(): FeedEnv {
  loadEnvForNotifications();
  return process.env;
}

/**
 * What the browser needs to open this person's feed, or null without Knock
 * keys (the feed then shows its empty state).
 */
export async function getNotificationFeedConfig(
  userId: number,
  env: FeedEnv = currentEnv()
): Promise<NotificationFeedConfig | null> {
  const publicApiKey = env.KNOCK_PUBLIC_API_KEY;
  const signingKey = env.KNOCK_SIGNING_KEY;
  const feedChannelId = env.KNOCK_FEED_CHANNEL_ID;
  if (!publicApiKey || !signingKey || !feedChannelId) return null;

  return {
    userId,
    userToken: await signUserToken(String(userId), {
      signingKey,
      expiresInSeconds: TOKEN_LIFETIME_SECONDS,
    }),
    publicApiKey,
    feedChannelId,
  };
}
