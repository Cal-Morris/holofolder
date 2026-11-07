# Framer marketing and the app

The public site is `https://holofolder.com`. Framer serves marketing and forwards two External Multi Site rules without stripping the prefix:

- `/app` to `https://app.holofolder.com/app`
- `/app/*` to `https://app.holofolder.com/app/:1`

`app.holofolder.com` is the existing Vercel project's verified origin. It is not the public app URL. No app-domain redirect back to Framer may be configured on Vercel, since Framer needs to fetch it.

Next.js builds with `basePath: "/app"`. Next Link and router destinations stay app-relative (`/auth/login`, `/studio`, `/`). Raw fetches, images, anchors, share links and service worker paths include `/app`. `appPath` prefixes a raw path once. `binderHref` returns an unprefixed router destination; wrap it with `appPath` for a full browser navigation. Don't prefix a Next Link/router destination twice.

## Auth and origin checks

Supabase Site URL: `https://holofolder.com/app`. Allow the public `/app/auth/callback` and `/app/auth/confirm` URLs and recovery callback query. Keep old callbacks during the transition. `NEXT_PUBLIC_SITE_URL` in production is the public app URL, not the Vercel upstream. Local/preview callbacks use the browser's own origin.

Server auth redirects explicitly map requests arriving at app.holofolder.com back to holofolder.com. They never infer the public host from arbitrary forwarded headers. Appearance writes accept the public Origin when the request URL is the known Vercel upstream, retaining the existing cross-site rejection.

Framer must preserve query strings, Set-Cookie, request cookies, Origin, the HTTP method/body and private/no-store response headers. Authenticated HTML and API responses must not be cached by a proxy.

Mail sending from mail.holofolder.com stays in Resend/Supabase SMTP; it does not change these URLs.

Analytics and Speed Insights use `/app/_vercel/…`; a Vercel edge rewrite forwards those requests to its built-in telemetry endpoints. Workflow callbacks retain their root platform URLs through a separate edge rewrite.

## PWA and existing devices

The manifest launches at `/app` and its scope is `/app`. The worker script is served from `/app?service-worker=1`, rewritten to the public `/app/sw.js` before session checks. A slashless script URL naturally permits `/app` scope without a `Service-Worker-Allowed` response header, which Framer drops. The origin's header remains for updates of old binder.cal.gg root registrations. Its navigation handler explicitly checks `/app` or `/app/…`; marketing, auth and public shares cannot fall back to someone's cached binder. The legacy hostname alone retains root/offline-entry fallback for existing installs. Only the static `/app/app-shell` HTML is cached.

After the new worker registers on holofolder.com, the previous root binder worker is unregistered if present, without deleting account storage. binder.cal.gg keeps its legacy root registration.

The shell cache is v5. Existing data, images, prepared images, IndexedDB and localStorage identifiers stay stable. Rendering and offline reads recognize old `/api/…` image/cache URLs; queued edits are not rewritten or removed.

The legacy binder.cal.gg host temporarily redirects its old root paths to `/app` on that same hostname, keeping its browser origin, cookies and local data. Its old worker and eBay endpoint are rewritten to the Vercel origin without redirects. That preserves access for syncing queued edits and keeps the registered eBay endpoint unchanged. Do not replace this with a blanket cross-domain redirect while devices may have queued work. The Vercel edge also preserves root Workflow callbacks by rewriting them to `/app/.well-known/workflow/…`.

A different hostname cannot read existing on-device data. Sync old devices before moving to holofolder.com; users will sign in again and reinstall the new origin's PWA.

## Paused branches

Reconcile unpublished push notification routes, recovery links, worker registration/click destinations and public icon paths against this contract before shipping those branches. The Next marketing `/home` work is superseded by Framer. Do not bulk-stage or reset the show workflow branch's mixed index.

## Workflow delivery on Vercel

Production and preview set `NEXT_ENABLE_ADAPTER=0`. The Vercel Next.js adapter currently routes queue deliveries to a nonexistent Pages Router module when `basePath` is set, so Workflow accepts runs but never executes them. This temporarily opts out of that adapter while retaining `/app`. See [the upstream issue and workaround](https://github.com/vercel/workflow/issues/4971). Remove the setting once the adapter fix ships.

The setting requires a fresh deployment. Verify the build log no longer says `Applying modifyConfig from Vercel`, and check a new partner acquisition reaches `partner_push_deliveries` and completes. HTTP route availability alone does not verify queue delivery.

## Marketing sign-in state

Framer's `Code/SessionLabel.tsx` checks `GET /app/api/auth/session` with same-origin credentials and no caching. The endpoint verifies the existing Supabase cookie and returns only `{ signedIn: boolean }`, with `Cache-Control: private, no-store` and `Vary: Cookie`. It needs no CORS or shared token storage. Keep this response uncached in the Framer proxy.

The nav, hero and pricing CTAs retain their `/app/` links and show “Go to dashboard” for a signed-in visitor. Their original labels remain the fallback during loading, offline or on errors. The label rechecks on focus, visibility and page restore so signing in or out in another tab is picked up when returning to marketing. This requires signing in on the public `holofolder.com` origin; cookies from `app.holofolder.com` or `binder.cal.gg` cannot identify a visitor on another hostname.
