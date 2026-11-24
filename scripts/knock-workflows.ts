// Upserts and commits every Notification workflow to Knock's Development
// environment through the Management API. Safe to re-run: each run makes Knock
// match the code again.
//
//   npm run knock:workflows             # upsert + commit all workflows
//   npm run knock:workflows -- --dry-run  # print what would be sent
//
// Needs KNOCK_SERVICE_TOKEN (Knock dashboard → Settings → Service tokens) and
// KNOCK_FEED_CHANNEL_ID in .env. Set KNOCK_FEED_CHANNEL_KEY to skip looking the
// channel's key up from its id.

import { existsSync } from "node:fs";
import { z } from "zod";
import {
  knockWorkflowDefinitions,
  type KnockWorkflowDefinition,
} from "../app/lib/notifications-knock.server";

const CONTROL_API = "https://control.knock.app/v1";
const ENVIRONMENT = "development";

const dryRun = process.argv.includes("--dry-run");

if (existsSync(".env")) process.loadEnvFile(".env");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Add it to .env and run again.`);
    process.exit(1);
  }
  return value;
}

async function control(
  serviceToken: string,
  method: "GET" | "PUT",
  path: string,
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${CONTROL_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${serviceToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const channelListing = z.object({
  entries: z.array(z.object({ id: z.string(), key: z.string() })),
});

/** The Management API addresses channels by key; .env holds the id. */
async function feedChannelKey(serviceToken: string): Promise<string> {
  const configured = process.env.KNOCK_FEED_CHANNEL_KEY;
  if (configured) return configured;

  const channelId = requireEnv("KNOCK_FEED_CHANNEL_ID");
  const listing = channelListing.parse(
    await control(serviceToken, "GET", "/channels")
  );
  const channel = listing.entries.find((entry) => entry.id === channelId);
  if (!channel) {
    throw new Error(
      `No Knock channel has id ${channelId}. Check KNOCK_FEED_CHANNEL_ID, or set KNOCK_FEED_CHANNEL_KEY.`
    );
  }
  return channel.key;
}

function upsertPath({ key }: KnockWorkflowDefinition) {
  const query = new URLSearchParams({
    environment: ENVIRONMENT,
    commit: "true",
    commit_message: `Sync ${key} from Cadence`,
  });
  return `/workflows/${encodeURIComponent(key)}?${query}`;
}

async function main() {
  if (dryRun) {
    const channelKey = process.env.KNOCK_FEED_CHANNEL_KEY ?? "<feed channel key>";
    for (const definition of knockWorkflowDefinitions(channelKey)) {
      console.log(`PUT ${upsertPath(definition)}`);
      console.log(JSON.stringify({ workflow: definition.workflow }, null, 2));
    }
    return;
  }

  const serviceToken = requireEnv("KNOCK_SERVICE_TOKEN");
  const channelKey = await feedChannelKey(serviceToken);

  for (const definition of knockWorkflowDefinitions(channelKey)) {
    await control(serviceToken, "PUT", upsertPath(definition), {
      workflow: definition.workflow,
    });
    console.log(`✓ ${definition.key} (${definition.workflow.categories.join(", ")})`);
  }
  console.log(`All workflows committed to Knock ${ENVIRONMENT}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
