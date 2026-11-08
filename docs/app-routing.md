# Framer marketing and the app

The public site is `https://holofolder.com`. Framer serves marketing and forwards two External Multi Site rules without stripping the prefix:

- `/app` to `https://app.holofolder.com/app`
- `/app/*` to `https://app.holofolder.com/app/:1`

`app.holofolder.com` is the existing Vercel project's verified origin. The public browser app stays on `holofolder.com/app`; developer clients use this origin directly. No app-domain redirect back to Framer may be configured on Vercel, since Framer needs to fetch it.

Next.js builds with `basePath: "/app"`. Next Link and router destinations stay app-relative (`/auth/login`, `/studio`, `/`). Raw fetches, images, anchors, share links and service worker paths include `/app`. `appPath` prefixes a raw path once. `binderHref` returns an unprefixed router destination; wrap it with `appPath` for a full browser navigation. Don't prefix a Next Link/router destination twice.

## Direct developer access

Developer REST clients use `https://app.holofolder.com/app/api/v1`; remote MCP clients use `https://app.holofolder.com/app/mcp`. These requests bypass Framer, which drops the `WWW-Authenticate` header needed for MCP OAuth discovery. The discovery header and protected-resource metadata both identify the direct host. OAuth consent and account settings stay on the public website.

The API reference playground also calls the direct REST host with cookies omitted. REST permits CORS with bearer API keys, including Authorization, Content-Type and Idempotency-Key preflights; it never accepts cookie authentication. The app's internal API calls, session cookies and offline paths remain same-origin under `holofolder.com/app`.

Migration `067_direct_developer_access.sql` moves the token audience and authorization/consent checks together to the exact direct MCP resource. Deploy the matching code and apply the migration before clients reconnect. Old resource URLs/tokens are rejected; clients must reconnect using the direct URL. First-party sign-in is unchanged.

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

## Named binder links

An account username is saved in Settings → Account; each selected binder gets its own slug in Settings → Share. Only the binder owner can edit its slug. Partners can set their own account username, but shared binders always use the owner's username. Names are lowercase letters, numbers and hyphens, with an alphanumeric start/end (username 3–30, binder slug 1–60 characters).

The public address is `https://holofolder.com/@cal/national`. Sharing must be enabled. Existing token links continue working; both formats check the same enabled flag. Renaming a username/slug breaks its previous named address. Claimed names remain reserved to the original account/binder, including after deletion, so old links cannot be taken over. No `/@cal` profile or binder directory is exposed.

After the app route is deployed, add this Framer Site Settings → Hosting → Multi Site rule:

| Field | Value |
| --- | --- |
| Path | `/@*/*` |
| Type | External |
| URL | `https://app.holofolder.com/app/u/:1/:2` |

Keep the existing `/app` and `/app/*` rules. Framer rewrites the request while preserving the visible named URL. No DNS or Next basePath change is needed. The origin route `https://app.holofolder.com/app/u/cal/national` can be checked independently, but does not prove the Framer rewrite works. The exact literal-@ wildcard rule and hydration through it require a published-site check. Browser verification is currently paused at Cal's request, so this remains a rollout gate.

Apply `scripts/045_named_binder_shares.sql`, `scripts/047_account_usernames.sql` and `scripts/048_named_share_account_identity.sql` in order before enabling named addresses. Account usernames use the existing 047 profile settings and canonical identity store; 048 preserves existing saved names while connecting binder sharing. These migrations have been applied and verified on the hosted project. If it is missing, the new controls report unavailable and token sharing still works. Named routes and token routes are read-only, noindex and request-time rendered. The service worker excludes both from private offline-shell fallback; `/@…` is outside the app scope. Open pages retain already downloaded cards, so revocation prevents new loads rather than erasing a visitor's existing copy.

## Email signup confirmation across devices

The hosted Supabase **Confirm sign up** email template uses this URL for every confirmation button and plain-text fallback:

```html
{{ .RedirectTo }}?token_hash={{ .TokenHash }}&amp;type=email
```

`RedirectTo` is the `/app/auth/callback` URL passed by both signup forms. The callback calls `verifyOtp`, so the email can be opened on a different device. Do not switch this template back to `ConfirmationURL`: with the SSR client's PKCE flow that verifies the email upstream, then redirects with a code whose exchange needs the original browser's verifier cookie.

Applied to all three links in the production signup template on 8 November 2026. A fresh-session production request with a generated email token returned 307 to `/app` and set the session cookie without a verifier. Existing emails retain their original links; after an old cross-device code exchange fails, the email may already be confirmed, so password sign-in can succeed. New confirmations must use a newly requested email.
