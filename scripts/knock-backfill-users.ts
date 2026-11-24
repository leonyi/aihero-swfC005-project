// One-off backfill: syncs every existing user to the Notification vendor
// (name, email, avatar, and the default preferences for anyone who has none).
// Safe to re-run: it never overwrites preferences a person already has.
//
//   npm run knock:backfill-users
//
// Sends to Knock when KNOCK_SECRET_API_KEY is set in .env; otherwise logs.

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../app/db/schema";
import { getNotificationPort } from "../app/lib/notification-port.server";
import { syncAllUsers } from "../app/lib/users.server";

const db = drizzle(new Database("data.db"), { schema });

syncAllUsers(db, getNotificationPort())
  .then(() => console.log("Backfill finished."))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
