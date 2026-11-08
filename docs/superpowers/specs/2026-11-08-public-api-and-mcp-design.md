# Public API and MCP

Status: approved by Cal on 2026-11-08. No product implementation yet.

## Intent and agreed requirements

Expose Holo Folder's catalog and user operations through a documented raw API and a remote MCP server. This should offer the catalog access people expect from TCGdex, alongside Holo Folder's binders, collections, wanted lists and pricing. Do not promise better data coverage than the actual mirror contains.

Cal specified:

- Premium or lifetime access is required.
- Expose the entire available card dataset and the operations available through the UI, including binder management, search and card lookup.
- API images must come from our R2 bucket.
- MCP clients connect through OAuth with a consent screen. They do not need API keys.
- API keys are for the raw API. Use Supabase for identity and credential/grant storage.

## Approved product decisions

These author-proposed defaults were included in Cal's design approval:

- Exclude signup trials from developer access. Require a currently paid subscription or perpetual licence, including existing grandfathered licences. Do not inherit the application's staged billing-enforcement bypass.
- Follow existing collection-owner entitlement rules for partners. Credentials belong to the individual actor; shared collection access follows current membership on every request. Leaving a partnership immediately removes access to its data.
- Offer read-only access by default and optional write permissions. All normal collection operations remain available with the appropriate permissions. Sharing and partner changes require separate explicit permissions.
- Keep billing changes, account deletion, credential management and device push enrollment in the signed-in website for this release. Camera capture, screen wake locks, local cache management and offline queues are device actions, not remote operations. Expose existing server-side lookup/import resolution, not a new hosted OCR service.
- No general third-party app developer portal or SDK packages in this release. OAuth client registration exists to onboard compatible MCP clients.

## Public interfaces

Use the existing Next.js application and base path, without adding another deployment:

- Raw REST API: `https://holofolder.com/app/api/v1`.
- Remote MCP: `https://holofolder.com/app/mcp`, using Streamable HTTP.
- Consent page: `https://holofolder.com/app/oauth/consent`.
- Developer settings: API keys, connected MCP clients, permissions, expiry and revoke controls.
- Publish OpenAPI and setup documentation using Fumadocs, including the MCP URL and a working API-key example. Documentation and discovery metadata are public; catalog and private operations require authentication and entitlement.

The raw API accepts personal API keys as bearer credentials. MCP accepts only OAuth access tokens. Neither accepts the other credential type or silently falls back to browser cookies. Existing UI session authentication stays supported on its own routes.

MCP discovery must work at the standards-required protected-resource metadata path for this resource. Confirm Framer routing and Next basePath rewrites explicitly; do not assume root `/.well-known` is forwarded. Advertise the reachable metadata URL in `WWW-Authenticate`.

## Shared operations and coverage

Extract operations from existing routes and direct Supabase callers into server services as needed. The UI, REST handlers and MCP tools use the same validation, membership checks, side effects and conflict handling. MCP calls services directly; do not manufacture API keys or loop back through HTTP. Avoid moving unrelated code.

| Area | Required coverage |
| --- | --- |
| Catalog | Paginated card list and individual lookup, languages, series, sets and set contents, Pokémon/dex links, illustrators, available external identifiers and canonical aliases |
| Search | Card name, collector number, set and illustrator search, existing corrections and filters, plus paginated traversal rather than a fixed top-result ceiling |
| Prices | Available normalized prices, currency, finish, confidence, source evidence, freshness, trends, existing comparison results and bounded refresh/job operations |
| Binders | List, create, rename, reorder, delete, identity/slug and appearance, including uploads where the UI supports them |
| Collection and wanted | Paginated reads, add/update/remove owned slots and wanted printings, language/finish/status, wanted-person assignments, import resolution and export |
| Sharing and partners | Read/manage share state and links; invite, accept, reject and disconnect with current owner/member restrictions |
| Settings and identity | Read/update account identity and persisted collection preferences, keeping actor-owned identity distinct from collection-owner settings |
| Collection tools | Existing collection analytics, show purchase records and undo, deal calculations and comparison job start/status/cancel |

During implementation create a route/tool coverage checklist against every current UI data operation, including hooks that access Supabase directly. Catalog records mean data Holo Folder actually stores and can disclose, not administrative tables, credentials, billing records, hidden provider payloads or another user's data. Existing provider limitations and attribution remain visible. Any uncovered operation is an explicit gap, not a claim of full parity.

## Identity and authorization

Resolve one internal principal containing actor id, credential/grant id, transport and granted permissions. Never trust a caller-provided owner id. Resolve current membership and collection owner server-side, then verify resource ownership before using a service-role client.

Each operation declares one or more permissions: `catalog:read`, `prices:read`, `prices:refresh`, `binders:read`, `binders:write`, `collection:read`, `collection:write`, `settings:read`, `settings:write`, `sharing:manage`, `partners:manage`. Analytics and show purchase operations use collection read/write respectively. Permission changes require a fresh user authorization; credential administration is website-session-only.

Entitlement is checked on each data request and each MCP tool call, even within an established connection. Expired subscriptions and lookup failures cannot use the staged UI billing bypass. Credential revocation, grant revocation and membership changes take effect on the next operation. An already returned response cannot be recalled. Free users may sign in and see an upgrade explanation, but cannot authorize data access or issue usable keys. They can still revoke credentials.

## API keys

Create cryptographically random personal keys with a recognizable public prefix and a separate random secret. Show the full key once. Store only a cryptographic digest of the high-entropy secret, public identifier/prefix, actor id, name, permissions, created/expiry/revoked timestamps and bounded last-used metadata in Supabase. Never store plaintext keys or return them from list endpoints.

Users can list, create and revoke their own keys through the signed-in website. Rotation creates a replacement key and revokes the old one when the user chooses; never recover an existing secret. Keys have explicit expiry choices and a bounded number per user. Verification uses constant-time digest comparison and rejects malformed, expired or revoked credentials. Keys are not Supabase anon/service-role project keys.

## OAuth and MCP

Use Supabase Auth's OAuth server with authorization code and PKCE, compatible MCP client registration, and the existing account login. The consent page fetches the actual authorization details from Supabase, shows the client name and redirect host, explains read/write and destructive permissions, and offers approve/deny. Preserve the authorization request across login. Do not trust client-supplied display text or redirect URLs.

Supabase's OIDC scopes do not enforce application/database permissions. Store our per-user, per-client grants separately and enforce them in every MCP operation. Bind approval to the verified authorization request and client; persist permission changes only through a same-origin, CSRF-protected user action. Check active grant status on every tool call. Reauthorization after revocation must create a new authorization boundary so an old still-unexpired token cannot regain access; select a verifiable token/session/grant-version binding during the auth compatibility check.

Before enabling OAuth issuance, audit access through PostgREST, Storage, Realtime, exposed RPCs and existing application routes. Restrict OAuth `client_id` tokens from accessing private data outside the MCP permission boundary. Adding an MCP check alone is insufficient because existing authenticated-role policies may otherwise accept these tokens. Keep direct first-party sessions working. Never pass client bearer tokens through as downstream credentials.

Validate signature, issuer, expiry, subject, OAuth client identity and intended resource/audience. Reject regular login JWTs, ID tokens and access tokens meant for another resource. Support discovery, PKCE and refresh/reconnect with an actual MCP client. This is an implementation gate: prove the hosted Supabase OAuth configuration supports the required resource binding and client registration before committing to its token verifier. If it cannot, report the exact incompatibility and propose an established OAuth authorization service backed by Supabase identity; do not invent a custom OAuth server or weaken validation.

Use a supported MCP SDK, with stateless request handling where possible on Vercel. Keep user identity out of shared process state. Declare read-only/destructive tool annotations accurately; annotations are hints, not authorization. Deleting a populated binder preserves the UI's explicit confirmation requirement. Expose binary uploads via a bounded authenticated upload workflow rather than stuffing unrestricted data into tool arguments.

## R2-only images

All API and MCP image fields, including nested collection/wanted card images, reference verified objects in our existing R2 mirror or a stable endpoint that reads only R2. Never return upstream URLs or use the current image proxy's upstream fallback for these interfaces. Keep external provider IDs distinct from image URLs.

If no mirrored image exists, return `image: null` with a documented availability state; the catalog record still exists. An unavailable store returns a clear error for image retrieval, never an upstream redirect. Trusted ingestion/backfill fills gaps under existing source restrictions and budgets; public requests cannot trigger arbitrary source fetches or unbounded uploads. Reuse object keys and formats, avoid a second image store. Resolve conflicts between older source restrictions and the current fallback mirror policy explicitly before adding new ingestion behavior.

If R2 uses a public CDN domain, paid access gates discovery/data operations, not possession of previously obtained public image URLs. This design does not promise private image DRM. If using an authenticated image endpoint, authenticate before cache access and prevent shared-cache entitlement bypass.

## API contracts and resource limits

Use stable IDs, canonical alias metadata, explicit language/finish fields, normalized domain types and consistent error bodies with a code and request id. Return 401 for invalid credentials, 403 for missing permissions, 402 for missing developer entitlement, 404 for inaccessible resources, 409 for conflicts, 422 for supported-but-unavailable operations, 429 with Retry-After for limits, and 503 for dependency failures. MCP maps these to actionable protocol/tool errors without leaking secrets.

All list/search endpoints support bounded pagination with stable deterministic ordering. Page database reads beyond PostgREST's 1000-row cap. Prevent unrestricted filters, SQL fragments, unbounded batches and unlimited provider refresh. Preserve atomic collection compare-and-set semantics and existing acquisition notifications. Require fingerprints/version preconditions on external updates/deletes where a stale write could overwrite UI changes. Provide idempotency for create/purchase/expensive job operations so retries do not duplicate effects.

Initial author-selected limits: 60 read requests/minute per actor across credentials, 20 writes/minute, and existing stricter provider/job cooldowns. Limit body sizes, batch sizes and page size to 100. Use an atomic shared limiter backed by Supabase for this deployment, not process-local counters. Include pre-auth IP abuse controls and bounded retention of limiter/idempotency metadata. Document that credentials do not grant unrestricted bulk extraction or override provider limits.

Private responses and credential/consent screens are no-store. Exclude these interfaces from service-worker caching. Redact Authorization, keys, OAuth codes and sensitive payloads from logs; record actor, credential/client, operation, outcome and request id with bounded retention. Preserve existing licensing attribution and price confidence gates.

## Delivery and proof

This is a multi-step project, not a single small release. After design approval, write the implementation plan and split independently reviewable changes while keeping incomplete public interfaces disabled.

1. Prove OAuth audience/discovery/registration and identify all database/API bypass paths. Inventory operation parity and actual R2 coverage. No public OAuth issuance before restrictions are installed.
2. Implement shared authorization, credentials/grants, limits and compatible migrations, plus developer settings and consent. Apply and verify only this task's required migrations on the existing hosted project.
3. Deliver the complete versioned API and OpenAPI contract using shared services, with focused tests for permissions, entitlement, ownership, pagination, conflicts, revocation and image provenance.
4. Deliver OAuth MCP tools against those same operations and verify a real client sign-in, consent, read, write, deny, revoke and reconnect flow.
5. Verify all operation coverage, mobile settings/consent at required widths and PWA insets, existing offline behavior, deployment routing and production behavior. Release under the repository's Typecheck/Vercel gates and quota exception. Do not run the full e2e suite unless Cal asks.

Do not call the project complete while operations are unimplemented, OAuth compatibility or production routing is unresolved, migrations are unapplied, or images can fall back upstream. Report partial deliveries and concrete blockers plainly.

## References checked

- Supabase OAuth setup and MCP onboarding: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/ai-tools/byo-mcp.mdx
- Supabase token security and application/database permission distinction: https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/oauth-server/token-security.mdx
- MCP resource/audience validation: https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/authorization/index.mdx
- Local contracts: `docs/app-routing.md`, `lib/billing.ts`, `lib/server/billing.ts`, `lib/server/collection-owner.ts`, `app/api/binders/route.ts`, `app/api/collection/route.ts`, `lib/tcg-mirror.ts`, `lib/card-image-store.ts`, `lib/card-image-r2.ts`, `hooks/use-partner.ts`, `hooks/use-show-purchase-sync.ts`.

## Approved documentation and routing follow-up

Cal approved execution in this session and selected Fumadocs (https://www.fumadocs.dev/). Public documentation should live at `/docs`, proxied by Framer to the Next.js `/app/docs` source path. Keep Next.js `basePath: "/app"`; check internal links, assets, canonical URLs and search under the proxy.

Cal also requested `/api` and `/auth` forwarding. On 2026-11-08 the Framer MCP successfully created `/docs` and `/docs/*` rewrites, but further inserts failed with: "This project has reached its maximum of 6 rewrites." The verified branch contains the two docs rules plus the existing `/app`, `/app/*`, `/@*/*` and `/llms.txt` rules. Do not remove these to make room without agreement. Use `/app/api` and `/app/auth` until capacity changes. No root API/auth rules were created.

Framer branch: https://framer.com/projects/Holo-Folder--XORHOjHtiVkI2Vplan8k-d9DvZ?branch=idi2yhoh3&node=augiA20Il
Docs rules are staged on that branch, not merged or published. Publish only when the docs route is deployed and verified.

Routing update: Cal replaced the llms.txt rewrite with `/api/*` manually. On live reread, its new id was `TrqA32GLh`, initially targeting `/api/:1` on Vercel. Corrected only its target to `https://app.holofolder.com/app/api/:1`, preserving Cal's other edits. Root `/api/v1` is now the intended public API path once this Framer branch is published; `/app/api/v1` remains compatible. `/auth` is still absent and the six-rule limit remains. Do not restore the removed llms.txt rule.


2026-11-08 approved clarification: private user-uploaded binder artwork also moves to a separate private R2 bucket. Share the owner-authorized signed-upload/download service across UI, REST and MCP. Copy and hash-verify existing Supabase artwork before cutover; retain source objects for rollback. No upstream or Supabase image-serving fallback. See docs/public-api/private-artwork.md.
