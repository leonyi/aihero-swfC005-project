# How far can web push reach without a native app?

Research for [#3](https://github.com/leonyi/aihero-swfC005-project/issues/3) (map [#1](https://github.com/leonyi/aihero-swfC005-project/issues/1)). Every source was read on **2026-11-21**, and only primary sources were used: MDN and its browser-compat-data (BCD), W3C, IETF, WebKit, Apple Developer, Chrome/Google and Mozilla.

## TL;DR

**Web push can't be the default out-of-app channel for Cadence. It works only as an opt-in extra next to email**, which stays the default for anything a person must not miss.

- **Desktop:** all the major engines support it. That is Chrome 42+, Edge 17+, Firefox 44+, Opera 29+ and Safari 16+ on macOS 13 Ventura+ ([BCD 8.1.10](https://unpkg.com/@mdn/browser-compat-data/data.json)).
- **Android:** Chrome, Firefox and Samsung Internet support it. Android WebView does not, so in-app browsers built on it can't subscribe ([BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)).
- **iPhone and iPad:** push works only in a **Home Screen web app** on iOS/iPadOS 16.4+. A Safari tab never receives push ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)). iOS 26 makes every site added to the Home Screen open as a web app, which helps a little. The person still has to add it themselves ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- **Permission:** a person grants it once per browser or device, from a user gesture. A "Block" is effectively permanent ([web.dev](https://web.dev/articles/push-notifications-permissions-ux)).
  - Chrome moves sites with low accept rates to a quieter prompt ([Chrome](https://developer.chrome.com/blog/notification-permission-data-in-crux)).
  - Since Oct 2025, Chrome auto-revokes permission from sites that send a lot of notifications but get little engagement ([Google](https://blog.google/chromium/automatic-notification-permission/)).
  - Since Jan 2026, Chrome rate-limits pushes from "disruptive" sites ([Chrome](https://developer.chrome.com/blog/web-push-rate-limits)).
- **Delivery is best-effort by design.** A push service "MAY expire a subscription at any time", may keep a message for less time than you asked, and may expire it early ([RFC 8030](https://www.rfc-editor.org/rfc/rfc8030)). Safari also revokes subscriptions whose pushes don't show a notification ([WebKit](https://webkit.org/blog/12945/meet-web-push/)).

## 1. Browser support today

Data from MDN browser-compat-data **v8.1.10** (built 2026-11-19), keys `api.PushManager`, `api.PushManager.subscribe` and `api.ServiceWorkerRegistration.showNotification` ([data.json](https://unpkg.com/@mdn/browser-compat-data/data.json), read 2026-11-21):

| Browser | Push API / `showNotification` since | BCD note |
| --- | --- | --- |
| Chrome (desktop, Android) | 42 | `subscribe` needs `applicationServerKey` |
| Edge | 17 | `subscribe` needs `applicationServerKey` |
| Opera | 29 | |
| Firefox desktop | 44 | user gesture required from 72 |
| Firefox Android | 48 (`showNotification` 44) | user gesture required from 79 |
| Samsung Internet | 4.0 | `subscribe` needs `applicationServerKey` |
| Safari macOS | 16 | "Notifications are supported on macOS Ventura and later." |
| Safari iOS/iPadOS | 16.4 | "Notifications are supported in web apps saved to the home screen." |
| Android WebView | not supported | |

- MDN labels the Push API "Baseline Widely available … since March 2023" ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), 2026-11-21). For iOS, Baseline here still means Home Screen web apps only.
- BCD for `api.Notification` on `safari_ios` says: "The `Notification` interface is undefined, unless the page is a web app saved to the home screen. The app's manifest must have a non-default `display` value" ([BCD](https://unpkg.com/@mdn/browser-compat-data/data.json), 2026-11-21).
- Safari 16 on macOS uses a system daemon (`webpushd`) and APNs, so pushes arrive even when Safari isn't running ([WebKit, Meet Web Push](https://webkit.org/blog/12945/meet-web-push/), 2026-11-21).
- Apple's own docs say: "Add web push to Home Screen web apps in iOS 16.4 or later and Webpages in Safari 16 for macOS 13 or later." No Apple Developer Program membership is needed ([Apple Developer](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), 2026-11-21).

## 2. iOS / iPadOS requirements

- **iOS/iPadOS 16.4+**, and the site must run as a **Home Screen web app**. Before iOS 26, that meant a site added through Share > Add to Home Screen whose manifest `display` is `standalone` or `fullscreen` ([WebKit, Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), 2026-11-21).
- **The permission request needs a direct user interaction.** "A web app that has been added to the Home Screen can request permission to receive push notifications as long as that request is in response to direct user interaction — such as tapping on a 'subscribe' button" ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), 2026-11-21).
- **iOS 26 / iPadOS 26:** "By default, every website added to the Home Screen opens as a web app", whether or not it has a manifest ([WebKit, Safari 26.0](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/), published 2025-09-15, read 2026-11-21). This removes the manifest trap. The person still has to find and use Add to Home Screen.
- **Other platform details:**
  - Push goes through APNs, so allow-list `*.push.apple.com`.
  - Notifications respect Focus modes.
  - The Badging API is available ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), 2026-11-21).
- **Declarative Web Push** (iOS/iPadOS 18.4, macOS 15.5):
  - `window.pushManager` subscribes without a service worker, and the push payload itself describes the notification ([WebKit, Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), 2026-11-21).
  - BCD lists `api.Window.pushManager` as Safari 18.4 and Safari iOS 18.4, with the note "Notifications are supported in web apps saved to the home screen". It is not in Chrome or Firefox ([BCD](https://unpkg.com/@mdn/browser-compat-data/data.json), 2026-11-21).
  - So it does **not** lift the Home Screen requirement on iOS.

**What this means for Cadence:** to reach an iPhone or iPad user by push, they must:

1. Add Cadence to the Home Screen.
2. Open it from there.
3. Tap an opt-in control.
4. Accept the OS prompt.

Each step loses people, and nothing about this funnel applies to email.

## 3. How browsers gate and penalise permission prompts

- **User gesture required.**
  - Firefox 72+: "`Notification.requestPermission()` and `PushManager.subscribe()` can now only be called in response to a user gesture such as a click event" ([MDN, Firefox 72 release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72), 2026-11-21). On Android this applies from Firefox 79 ([BCD](https://unpkg.com/@mdn/browser-compat-data/data.json)).
  - Safari requires "an explicit user gesture" ([WebKit](https://webkit.org/blog/12945/meet-web-push/)). Apple says to call subscribe "immediately from the gesture's event handler code" ([Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)).
  - MDN: "browsers will explicitly disallow notification permission requests not triggered in response to a user gesture." Chrome and Firefox also require a secure context (HTTPS) ([MDN, Using the Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API), 2026-11-21).
- **Chrome quiet UI.**
  - Chrome 80 introduced a quieter permission UI. "Chrome will automatically enroll sites with very low Accept rates into the quieter UI."
  - Enrollment is decided separately for mobile and desktop.
  - A "Block" means the person "is not interested … at any time" ([Chrome for Developers, CrUX notification data](https://developer.chrome.com/blog/notification-permission-data-in-crux), 2026-11-21).
- **Chrome auto-revocation** (announced 2025-10-10, Android and desktop).
  - Chrome automatically removes notification permission from sites with "very low user engagement and a high volume of notifications". It "does not revoke notifications for any installed web apps."
  - Google states: "Less than 1% of all notifications receive any interaction from users" ([Google, Chromium blog](https://blog.google/chromium/automatic-notification-permission/), 2026-11-21).
- **Chrome push rate limits** (from January 2026).
  - Sites judged disruptive are capped at "no less than 1000 per minute". Requests above that get HTTP 429.
  - The penalty lasts 1 day, then 7 days, then 14 days. The count resets after 42 days without disruptive behaviour ([Chrome for Developers, Web push rate limits](https://developer.chrome.com/blog/web-push-rate-limits), published 2026-01-06, read 2026-11-21).
- **Denied is sticky.** "If the user blocks the permission request, your web app can't ask for permission again." Recommended practice:
  - Never prompt on page load.
  - Use a "double permission" pre-prompt that you control.
  - Always offer a way to opt out ([web.dev, Permission UX](https://web.dev/articles/push-notifications-permissions-ux), 2026-11-21).
  - Permission states are `default`, `granted` and `denied` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API)).
- **Mozilla's own figure:** "unsolicited prompts are denied in over 99% of cases" (Mozilla Hacks, [Firefox 72 notification permission changes](https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/)). That page returned a Cloudflare challenge on 2026-11-21, so this quote is **not re-verified** today. The Firefox 72 gesture rule itself is verified through MDN above.

## 4. Delivery reliability and subscription lifecycle

- **RFC 8030** ([rfc-editor.org](https://www.rfc-editor.org/rfc/rfc8030), 2026-11-21):
  - The application server "MUST include the TTL (Time-To-Live) header".
  - A push service "MAY retain a push message for a shorter duration than requested", and "MAY later expire the message prior to its advertised Time-To-Live".
  - A message with zero TTL sent while the device is unavailable "is never delivered".
  - "A push service MAY expire a subscription at any time", and then MUST return **404** to senders.
  - A message whose delivery is abandoned yields **410** on the receipt subscription.
  - An optional `Urgency` header lets battery-constrained devices defer low-urgency messages.
- **W3C Push API** (Working Draft dated 21 November 2026, [w3.org/TR/push-api](https://www.w3.org/TR/push-api/), 2026-11-21):
  - A `PushSubscription` exposes a nullable `expirationTime`.
  - When a subscription is refreshed, or "can no longer be used, for example because it has expired", the user agent fires `pushsubscriptionchange`, with `newSubscription` set to null if it is lost.
  - The API is `[SecureContext]`.
- **No silent pushes.**
  - Chrome and Edge reject `subscribe` unless `userVisibleOnly: true` ([MDN, PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe), 2026-11-21).
  - Safari: "If you don't [show the notification], Safari revokes the push notification permission for your site" ([Apple](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers)). WebKit warns that service-worker bugs or network conditions can trigger this ([WebKit, Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)).
- **VAPID** ([RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), 2026-11-21):
  - The server signs an ES256 JWT with `aud` set to the push service origin.
  - `exp` must be no more than 24h ahead.
  - `sub` is an optional `mailto:` or `https:` contact.
  - `applicationServerKey` is the matching P-256 public key ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe)).
- **Endpoint secrecy.** The endpoint is a capability URL: "knowledge of the endpoint is all that is necessary to send a message" ([MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)).
- **What this means for Cadence:**
  - Subscriptions are per browser per device, so the hosted vendor (or our SQLite) holds one per device.
  - Prune a subscription on 404/410.
  - Push is never a guaranteed record. The Notification Feed and email are.

## 5. Conclusion

Web push is **not credible as the default out-of-app channel** for Cadence. It reaches desktop and Android browsers well. On iPhone and iPad it reaches only people who have installed Cadence to the Home Screen. Every browser requires a gesture-triggered, one-shot opt-in, and Chrome actively penalises sites whose prompts and pushes go ignored. Delivery and subscription lifetime are best-effort by spec.

Treat it as an **opt-in extra next to email**:

- Email stays the default for Notifications that matter.
- Every push mirrors an item in the Notification Feed.
- Ask for permission from an in-app control at a moment of clear value, never on load.
- Show Add to Home Screen guidance to iOS users.
- Keep push volume low and relevant to stay clear of quiet UI, auto-revocation and rate limits.

## Couldn't verify

- The Mozilla Hacks "over 99%" figure. The page was blocked by Cloudflare on 2026-11-21.
- The EU (DMA) status of Home Screen web apps. Apple's live DMA support page (read 2026-11-21) no longer discusses it, so I found no current primary statement.
- Whether third-party iOS browsers can install Home Screen web apps that receive push, on every iOS version.
- Real opt-in rates for a site like Cadence. Chrome publishes per-origin data through CrUX but no cross-industry figure.

## Sources (all read 2026-11-21)

- MDN browser-compat-data v8.1.10: https://unpkg.com/@mdn/browser-compat-data/data.json
- MDN, Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- MDN, PushManager.subscribe(): https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- MDN, Using the Notifications API: https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API/Using_the_Notifications_API
- MDN, Firefox 72 release notes: https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/72
- W3C, Push API: https://www.w3.org/TR/push-api/
- IETF RFC 8030, Generic Event Delivery Using HTTP Push: https://www.rfc-editor.org/rfc/rfc8030
- IETF RFC 8292, VAPID for Web Push: https://www.rfc-editor.org/rfc/rfc8292
- WebKit, Meet Web Push: https://webkit.org/blog/12945/meet-web-push/
- WebKit, Web Push for Web Apps on iOS and iPadOS: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, Meet Declarative Web Push: https://webkit.org/blog/16535/meet-declarative-web-push/
- WebKit, WebKit Features in Safari 26.0: https://webkit.org/blog/17333/webkit-features-in-safari-26-0/
- Apple Developer, Sending web push notifications in web apps and browsers: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- Chrome for Developers, Notification permission data in CrUX: https://developer.chrome.com/blog/notification-permission-data-in-crux
- Chrome for Developers, Increasing web push notification value with rate limits: https://developer.chrome.com/blog/web-push-rate-limits
- Google (Chromium blog), Automatic notification permission revocation: https://blog.google/chromium/automatic-notification-permission/
- web.dev, Permission UX: https://web.dev/articles/push-notifications-permissions-ux
- Mozilla Hacks, Firefox 72 notification permission changes (not re-verified): https://hacks.mozilla.org/2019/11/upcoming-notification-permission-changes-in-firefox-72/
