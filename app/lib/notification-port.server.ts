import { existsSync } from "node:fs";
import { knockNotificationPort } from "~/lib/notifications-knock.server";
import {
  loggingNotificationPort,
  type NotificationPort,
} from "~/lib/notifications.server";

// ─── The NotificationPort routes hand to services ───
// Knock when KNOCK_SECRET_API_KEY is set; otherwise Notifications are logged,
// like email falls back to .outbox/. Chosen per call, like the mailer.

let envLoaded = false;

/**
 * Vite only puts VITE_ values from .env on process.env, so the server reads
 * .env itself. A fresh clone or CI has no .env and gets the logging port.
 */
export function loadEnvForNotifications() {
  if (envLoaded) return;
  envLoaded = true;
  if (!process.env.KNOCK_SECRET_API_KEY && existsSync(".env")) {
    process.loadEnvFile(".env");
  }
}

export function getNotificationPort(): NotificationPort {
  loadEnvForNotifications();
  const secretApiKey = process.env.KNOCK_SECRET_API_KEY;
  return secretApiKey
    ? knockNotificationPort(secretApiKey)
    : loggingNotificationPort();
}
