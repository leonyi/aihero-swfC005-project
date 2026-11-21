# Which hosted notification vendor fits Cadence?

Research for [#2](https://github.com/leonyi/aihero-swfC005-project/issues/2), a child of the map [#1](https://github.com/leonyi/aihero-swfC005-project/issues/1).

- **Sources:** vendor docs, pricing pages and API references only. The npm registry was used to confirm that each Node SDK exists.
- **Date read:** every source was read on **2026-11-21**.
- **Prices change.** Re-check every number here on the vendor's pricing page before signing up.
- **Scope:** this file gives facts and a recommendation. The pick itself belongs to a separate grilling ticket.

## Recommendation: Knock

Knock is the only candidate that meets every hard criterion on its free plan and also has category × channel preferences on that plan:

- **Free tier:** Free is $0 and covers up to 10,000 messages a month [K1].
- **Feed security:**
  - Enhanced security mode makes every client call carry an RS256-signed user JWT [K2].
  - That JWT has `sub` set to the user id and an `exp`.
  - The Node SDK's `signUserToken` defaults to a 3600-second expiry [K2].
- **Feed API:** a headless REST feed returns `unread_count` and `unseen_count` [K3]. Messages can be marked seen, read or archived (and reversed) one at a time or in batches by ID [K4].
- **Preferences:** stored per recipient as categories × channel types, with workflows and individual channels on top [K5]. Basic channel, workflow and category preferences are on Free [K1].
- **Email:** Postmark, which Cadence already uses, is a supported email provider [K7].

Its costs:

- **Paid plan:**
  - Starter is $250/month for 50,000 messages, then $0.005 per message [K1].
  - Over the Free limit, Knock says it will contact you about billing. The page lists no published overage rate for Free [K1].
- **Billing unit:**
  - One message is one user on one channel, so a Feed item plus an email counts as 2 [K1].
  - Messages that preferences suppress, and failed or bounced messages, are not billed [K1].
- **Web push:**
  - There is no first-party browser push channel. Browser web push goes through Firebase Cloud Messaging [K6].
  - That means a Firebase project, the Firebase JS SDK, a service worker, and storing each browser's FCM token on the user's Knock channel data [K6].
  - Push providers listed: APNs, Amazon SNS, Expo, FCM, OneSignal [K6b].

Runner-up: **Courier.**

- **Strengths:** expiring scoped JWTs [C2], the best headless SDK surface including `readAll()` [C3], topic × channel preferences [C4], and gentle pay-as-you-go pricing [C1].
- **Weakness:** no first-party web push. It relies on a provider such as FCM or OneSignal [C5].
- **Token caveat:** a Courier token **never expires if `expires_in` is omitted** [C2], so expiry is opt-in.

## Comparison

| | Knock | Novu Cloud | MagicBell | Courier | SuprSend |
|---|---|---|---|---|---|
| **Free tier** | 10K messages/mo [K1] | 10K workflow runs/mo, 24h activity retention [N1] | **1K deliveries/mo**, 1 project [M1] | 10K sends/mo [C1] | 10K notifications/mo, SuprSend-branded inbox [S1] |
| **Headless feed: list** | `GET /v1/users/{id}/feeds/{channel_id}` [K3] | `useNotifications` / `@novu/js` [N4] | `GET /notifications` [M4] | `getMessages()` [C3] | `feedClient.fetch()` [S4] |
| **Unread count** | `meta.unread_count`, `unseen_count` [K3] | `useCounts({read:false})` [N4] | `GET /notifications/unread/count` [M4] | `getUnreadMessageCount()` [C3] | badge reset only. No count read documented [S4] |
| **Mark read** | single + batch by IDs [K4]; channel bulk endpoint exists [K4b] | `notifications.read()`, `archive()` [N4] | per-id + `POST /notifications/read` (all) [M4] | `read()`, `unread()`, `readAll()`, `archive()` [C3] | `markAsRead`, `markAllAsRead`, `markAsArchived` [S4] |
| **Per-user feed auth** | **RS256 JWT, `sub` + `exp`, enforced by enhanced security mode** [K2] | **HMAC-SHA256(secret, subscriberId)**. Static hash, no expiry documented [N2] | HS256 JWT with `user_external_id`. `exp` is optional and the docs' example uses 1 year [M2] | JWT from `POST /auth/issue-token`, scoped. **Never expires if `expires_in` omitted** [C2] | **ES256 JWT, `entity_id` + `exp`, enforced by enhanced security mode**, with a refresh callback [S2] |
| **Node SDK** | `@knocklabs/node` [NPM] | `@novu/api` [NPM] | `magicbell-js` [NPM] | `@trycourier/courier` [NPM] | `@suprsend/node-sdk` [NPM] |
| **Email, same workflow; Postmark?** | Yes; Postmark supported [K7] | Yes; Postmark supported [N5] | Yes. SendGrid, SES, Mailgun, SMTP and others. No named Postmark integration [M4] | Yes; Postmark supported [C6] | Yes; Postmark supported [S5] |
| **Web push** | Via FCM only [K6] | Via providers (FCM, OneSignal, Pusher Beams, Pushpad, webhook). VAPID not mentioned [N3] | **Native VAPID channel** [M3] | Via providers (FCM, OneSignal, others). No native channel [C5] | **Native**: VAPID key from the dashboard plus your own service worker [S3]. On all plans [S1] |
| **Vendor-stored category × channel prefs** | **Yes, on Free** [K1][K5] | No category concept. Workflow × channel and global channel only [N6] | Yes: `categories[].channels[]` via `PUT /channels/user_preferences` [M4]. Plan gating not stated [M1] | Yes: subscription topics with custom channel routing [C4]. Plan gating not stated [C1] | **Business plan only** ($250/mo). Not on Free or Essentials [S1] |
| **First paid step** | Starter $250/mo for 50K, then $0.005/msg [K1] | Pro from $30/mo for 30K runs, then $1.20/1K [N1] | Startup $249/mo for 50K, then $0.0025 [M1] | Business: $0.005 per send, including the first 10K [C1] | Essentials $100/mo for 50K, then $2/1K. Business $250/mo [S1] |
| **Billing unit** | message = user × channel [K1] | workflow run [N1] | each channel is a delivery [M1] | send [C1] | each channel counts separately [S1] |

## Notes per vendor

- **Knock.**
  - **Production security:** with enhanced security off, "a request with your public key can act as any user." Knock tells production environments to turn it on [K2].
  - **DevUI fit:** the server signs a token for whichever user is in the session.
  - **Token expiry:** the docs suggest matching the session lifetime, or using a short token and refreshing it through `onUserTokenExpiring` [K2].
  - **Plan gating:** the pricing page lists no plan gating for enhanced security or the feed. Only per-tenant preferences, RBAC, SAML and SCIM are Enterprise-only [K1].
- **Novu Cloud.**
  - **Pricing:** the cheapest paid tier, and all channels are on Free [N1].
  - **Auth:** `subscriberHash` is a deterministic HMAC of the subscriber id. The docs describe no expiry or scoping, so it fails the "expiring signed per-user token" bar [N2].
  - **Preferences:** no categories. Workflows marked critical bypass them [N6].
- **MagicBell.**
  - **Strengths:** native VAPID web push [M3], a complete REST feed including mark-all-read [M4], and category × channel preferences [M4].
  - **Auth:** HS256 user JWTs. The doc's own example sets `expiresIn: '1y'`, so a short expiry is our choice, not a vendor requirement [M2].
  - **Free tier:** 1,000 deliveries a month, counted per channel, in one project [M1]. That is thin for development across four roles with Feed plus email.
- **Courier.**
  - **Feed and preferences:** strong headless JS client [C3] and topic × channel preferences [C4].
  - **Pricing:** pay as you go, $0.005 per send with no bundle. Leaving Developer means every send is billed [C1].
  - **Web push:** needs a third-party provider [C5].
- **SuprSend.**
  - **Strengths:** native web push and ES256 expiring JWTs are on every plan [S1][S2][S3].
  - **Preferences:** both channel-level and category-level preferences need **Business ($250/mo)** [S1].
  - **Feed:** the JS feed client documents no unread-count read [S4].

## Sources (all read 2026-11-21)

- [K1] Knock pricing: https://knock.app/pricing
- [K2] Knock, Security and authentication: https://docs.knock.app/in-app-ui/security-and-authentication
- [K3] Knock, In-app API overview: https://docs.knock.app/in-app-ui/api-overview ; List feed items: https://docs.knock.app/api-reference/users/feeds/list_items
- [K4] Knock, Messages API (seen/read/archived, batch): https://docs.knock.app/api-reference/messages ; Message statuses: https://docs.knock.app/send-notifications/message-statuses
- [K4b] Knock, Channel bulk operations: https://docs.knock.app/api-reference/channels/bulk
- [K5] Knock, Preferences overview: https://docs.knock.app/preferences/overview
- [K6] Knock, Sending web push with FCM: https://docs.knock.app/tutorials/sending-web-push-notifications-with-fcm
- [K6b] Knock, Push overview: https://docs.knock.app/integrations/push/overview
- [K7] Knock, Postmark: https://docs.knock.app/integrations/email/postmark
- [N1] Novu pricing: https://novu.co/pricing
- [N2] Novu, Prepare Inbox for production: https://docs.novu.co/platform/inbox/prepare-for-production
- [N3] Novu, Push integrations: https://docs.novu.co/platform/integrations/push
- [N4] Novu, Headless Inbox API reference: https://docs.novu.co/platform/inbox/headless/api-reference
- [N5] Novu, Postmark: https://docs.novu.co/platform/integrations/email/postmark
- [N6] Novu, Preferences: https://docs.novu.co/platform/concepts/preferences
- [M1] MagicBell pricing: https://www.magicbell.com/pricing
- [M2] MagicBell, User JWT: https://www.magicbell.com/docs/api/authentication/user ; API authentication: https://www.magicbell.com/docs/api/authentication
- [M3] MagicBell, Web Push channel: https://www.magicbell.com/docs/channels/web_push
- [M4] MagicBell, API v2 reference (notifications, user_preferences, integrations): https://www.magicbell.com/docs/api/reference
- [C1] Courier pricing: https://www.courier.com/pricing
- [C2] Courier, Inbox authentication: https://www.courier.com/docs/platform/inbox/authentication
- [C3] Courier, courier-js: https://www.courier.com/docs/sdk-libraries/courier-js-web
- [C4] Courier, Preferences API: https://www.courier.com/docs/recipients/preferences/api
- [C5] Courier, Push overview: https://www.courier.com/docs/external-integrations/push/intro-to-push
- [C6] Courier, Postmark: https://www.courier.com/docs/external-integrations/email/postmark
- [S1] SuprSend pricing (plans, counting, feature table): https://www.suprsend.com/pricing
- [S2] SuprSend, Client authentication: https://docs.suprsend.com/docs/client-authentication
- [S3] SuprSend, Web push (JS): https://docs.suprsend.com/docs/js-webpush
- [S4] SuprSend, JS in-app feed: https://docs.suprsend.com/docs/js-inapp-feed.md ; Headless feed (React): https://docs.suprsend.com/docs/react-sdk-headless-feed.md
- [S5] SuprSend, Postmark: https://docs.suprsend.com/docs/postmark
- [NPM] npm registry, latest metadata for `@knocklabs/node`, `@novu/api`, `magicbell-js`, `@trycourier/courier`, `@suprsend/node-sdk`: https://registry.npmjs.org/
