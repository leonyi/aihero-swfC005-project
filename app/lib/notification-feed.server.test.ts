import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { getNotificationFeedConfig } from "~/lib/notification-feed.server";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const env = {
  KNOCK_PUBLIC_API_KEY: "pk_test_abc",
  KNOCK_SIGNING_KEY: Buffer.from(pem).toString("base64"),
  KNOCK_FEED_CHANNEL_ID: "6f1d7c1e-0000-4000-8000-000000000000",
};

function decode(part: string | undefined) {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString());
}

describe("getNotificationFeedConfig", () => {
  it("signs an RS256 user token for exactly this person", async () => {
    const config = await getNotificationFeedConfig(42, env);

    expect(config).toMatchObject({
      userId: 42,
      publicApiKey: "pk_test_abc",
      feedChannelId: env.KNOCK_FEED_CHANNEL_ID,
    });
    const [header, payload] = (config?.userToken ?? "").split(".");
    expect(decode(header).alg).toBe("RS256");
    expect(decode(payload).sub).toBe("42");
  });

  it("is null without Knock keys, so the feed shows its empty state", async () => {
    expect(await getNotificationFeedConfig(42, {})).toBeNull();
    expect(
      await getNotificationFeedConfig(42, { ...env, KNOCK_SIGNING_KEY: undefined })
    ).toBeNull();
  });
});
