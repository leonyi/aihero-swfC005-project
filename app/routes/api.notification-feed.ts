import type { Route } from "./+types/api.notification-feed";
import { requireUserId } from "~/lib/access.server";
import { getNotificationFeedConfig } from "~/lib/notification-feed.server";

// Signs a Notification Feed user token for the person in the session. The
// browser calls it when the bell mounts, when the DevUI switches user, and
// before the token expires. `config` is null without Knock keys.
export async function loader({ request }: Route.LoaderArgs) {
  const userId = await requireUserId(request);
  return Response.json(
    { config: await getNotificationFeedConfig(userId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
