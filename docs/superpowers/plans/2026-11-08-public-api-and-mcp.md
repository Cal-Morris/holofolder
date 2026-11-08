# Public API and MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Ship a Premium/lifetime REST API authenticated by personal keys and an OAuth-authenticated remote MCP server with complete supported UI data-operation coverage and R2-only images.

**Architecture:** Extract shared server operations from current routes and direct Supabase callers. REST and MCP independently authenticate into the same actor/permission context, then invoke these operations with current membership and entitlement checks. Supabase holds credentials, grants and atomic limits; R2 remains the image source.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript 6, Bun, Supabase Postgres/Auth, Vercel, Cloudflare R2 and Fumadocs; a current supported MCP TypeScript SDK selected after compatibility proof.

**Spec:** `docs/superpowers/specs/2026-11-08-public-api-and-mcp-design.md` (approved).

## Global Constraints

- OAuth only for MCP, API keys only for REST. No cookie fallback on either public transport.
- Premium subscription or lifetime/perpetual licence only; exclude signup trials and ignore the UI enforcement bypass.
- Default to read-only permissions; writes, partner management and sharing require explicit authorization.
- Check actor, current membership, resource ownership, entitlement and active credential/grant on every operation.
- API/MCP image fields refer only to verified R2 objects; unavailable images are null with an availability state.
- Reads: 60/minute/actor; writes: 20/minute/actor across credentials; stricter provider limits remain. Page and batch sizes at most 100.
- Private responses, consent and credential screens are no-store. Never log secrets or cache private API/MCP data in the service worker.
- Preserve first-party login, offline queues, conflict checks, acquisition side effects, provider evidence and price confidence gates.
- Keep features disabled until their release gates pass. No full e2e suite without Cal requesting it.
- Use an isolated branch off current `origin/main`; preserve existing dirty planning files. Read applicable repository skills and bundled Next.js docs before implementation.
- New migrations use the next free number at execution time; 057 is currently next, not a reservation. Follow the migration skill, apply required changes to hosted Supabase, verify, and record evidence.
- Separate independently reviewable changes, push once per ready PR, enforce Typecheck/Vercel and reviews, then verify production under the release skill. No speculative workflows or deployments.

## Review Focus

- A revoked MCP client is reauthorized while its old JWT remains valid: the old token must stay denied.
- Someone leaves a paid partnership while a key or MCP connection stays active: their next operation cannot reach the previous owner's data.
- Catalog traversal includes aliases, equal sort values and more than 1000 rows: deterministic pagination must not silently truncate or duplicate records in a stable dataset.
- Nested wanted cards contain legacy/upstream image URLs: serialization must never leak those URLs as API image fields.
- OAuth bearer tokens are submitted directly to PostgREST, Storage, Realtime, RPCs or old routes: no private-data bypass, while first-party sessions still work.

## File and interface boundaries

- `lib/developer-api/types.ts`: API-facing types only, importing domain/pricing types instead of redefining them.
- `lib/developer-api/permissions.ts`: permission allowlist and operation-to-permission mapping.
- `lib/developer-api/keys.ts`: client-safe key metadata validation and server-independent key parsing; secret generation/verification stays server-only.
- `lib/server/developer-access/{keys,grants,entitlement,principal,limits,idempotency}.ts`: focused security services.
- `lib/server/operations/{catalog,binders,collection,settings,identity,sharing,partners,prices,comparisons,analytics,show-purchases,deal-check,appearance,import}.ts`: shared domain operations, extracted incrementally.
- `lib/server/developer-images.ts`: R2-only image resolution and serializers.
- `app/api/v1/`: bounded REST handlers. `app/api/developer/`: first-party-session-only credential/grant administration.
- `app/mcp/route.ts`, `lib/server/mcp/{server,tools,auth,metadata}.ts`: MCP transport and adapters.
- `app/oauth/consent/page.tsx`, `components/oauth-consent.tsx`, `app/api/oauth/decision/route.ts`: login-preserving consent and approve/deny.
- `components/developer-settings.tsx`: lazy-loaded credential/connected-client UI integrated into `components/settings-modal.tsx`.
- `docs/public-api/{coverage,oauth-proof,openapi,usage}.md` plus a machine-readable `public/openapi.json`: auditable contracts and onboarding.
- Tests in `tests/developer-*.test.ts`, focused Playwright cases in `e2e/developer-access.e2e.ts` and `e2e/oauth-consent.e2e.ts`.

Shared signatures (server-only where they access credentials):

```ts
type DeveloperTransport = 'rest' | 'mcp'
type DeveloperPermission = 'catalog:read' | 'prices:read' | 'prices:refresh'
  | 'binders:read' | 'binders:write' | 'collection:read' | 'collection:write'
  | 'settings:read' | 'settings:write' | 'sharing:manage' | 'partners:manage'
type DeveloperPrincipal = {
  actorId: string; credentialId: string; transport: DeveloperTransport
  permissions: readonly DeveloperPermission[]
}
type OperationContext = {
  principal: DeveloperPrincipal; ownerUserId: string; memberIds: readonly string[]
  requestId: string
}
type Page<T> = { data: T[]; nextCursor: string | null }
```

Operation inputs/outputs reuse existing domain types. Define each concrete schema alongside its operation before adding a transport handler. No generic arbitrary-table API.

### Task 1: Prove OAuth compatibility and inventory parity

**Files:** Create `docs/public-api/oauth-proof.md`, `docs/public-api/coverage.md`; read auth setup, migrations, API routes, hooks, `docs/app-routing.md` and current SDK/docs.

**Interfaces:** Produces the exact issuer, MCP audience, discovery URLs, verified token/grant binding and operation coverage checklist consumed by all later tasks. No production OAuth issuance enabled yet.

- [ ] Resolve current `origin/main`, isolate the approved documents without touching existing dirty plans, and record baseline/branch. Read git-worktree and release skills before creating the implementation checkout.
- [ ] Inventory every UI data operation, including `hooks/use-partner.ts`, `hooks/use-show-purchase-sync.ts`, uploads, identity, import, price refresh and comparisons. Record service, REST method/path, MCP tool and permission for each. Explicitly mark approved website/device-only exclusions.
- [ ] Inspect hosted OAuth configuration without printing credentials. Check current official Supabase docs using Context7 and verify registration, PKCE, refresh, custom audience and access-token-hook support. A published docs example is not hosted proof.
- [ ] In a controlled test client, prove discovery and issuance for the exact MCP resource, deny unrelated resources, and verify an old JWT cannot regain access after revoke/reapprove. Try binding to OAuth session plus a grant/version claim stamped at original authorization and preserved across refresh. Do not substitute `iat` as the sole generation boundary.
- [ ] Inventory RLS, grants, SECURITY DEFINER RPCs, Storage, Realtime and old routes for OAuth-token bypass. Record the exact restrictions needed and first-party regression cases. Inventory current R2 coverage with bounded reads, not a new full upload run.
- [ ] Record pass/fail evidence, commands with secrets redacted, and required hosted changes. If resource binding or safe reauthorization is unsupported, stop the OAuth path and report the concrete blocker with an established authorization-service alternative. Do not invent an auth server.
- [ ] Commit the approved design, plan and proof/coverage documents as one planning change; no claim that data access is shipped.

### Task 2: Define permissions, developer entitlement and key format

**Files:** Create `lib/developer-api/{types,permissions,keys}.ts`, `lib/server/developer-access/entitlement.ts`, `tests/developer-access.test.ts`, `tests/developer-keys.test.ts`.

**Interfaces:** `requireDeveloperEntitlement(actorId: string): Promise<{ ownerUserId: string; memberIds: string[] }>` resolves current membership and requires subscription/perpetual source. `parseDeveloperKey(raw: string): { id: string; secret: string } | null`; `requirePermissions(granted: readonly DeveloperPermission[], required: readonly DeveloperPermission[]): void`.

- [ ] Write tests asserting subscription/perpetual acceptance, trial/free rejection even with `enforced:false`, dependency-error denial, unknown-permission rejection and missing permission denial. Test malformed/truncated/oversized keys.
- [ ] Run `bun test tests/developer-access.test.ts tests/developer-keys.test.ts`, confirm missing implementation failure.
- [ ] Implement allowlisted permission parsing and strict entitlement using existing billing source and current owner resolution. Generate keys server-side as `hf_<uuid>.<32 random bytes encoded base64url>`, storing SHA-256 of the high-entropy secret and comparing equal-length digests in constant time.
- [ ] Rerun focused tests, confirm pass, and commit this isolated security foundation.

### Task 3: Store credentials/grants and enforce shared request limits

**Files:** Create the next numbered migration for developer access, update `scripts/MIGRATIONS.md`; create `lib/server/developer-access/{keys,grants,limits,idempotency}.ts`, `scripts/verify-developer-access.ts`, `tests/developer-storage.test.ts`.

**Interfaces:** `authenticateKey(raw: string): Promise<DeveloperPrincipal>`; `requireMcpGrant(claims: VerifiedMcpClaims): Promise<DeveloperPrincipal>` where `VerifiedMcpClaims` is defined from Task 1's proved token binding; `consumeDeveloperLimit(actorId: string, kind: 'read' | 'write'): Promise<{ allowed: boolean; retryAfter: number }>`; `runIdempotent<T>(context: OperationContext, operation: string, key: string, input: unknown, action: () => Promise<T>): Promise<T>`.

- [ ] Write tests for revoked/expired/unknown keys, grant escalation, old-token reauthorization denial, cross-actor credential access and simultaneous requests sharing an actor budget.
- [ ] Run `bun test tests/developer-storage.test.ts`, confirm expected failures.
- [ ] Add service-role-only credential/grant tables and RPCs, constant-time key verification, atomic actor limit windows and bounded idempotency records. Maximum 10 active keys per actor, expiry choices 30/90/365 days, default 90. Store no plaintext keys. Limit metadata retention to 24 hours for idempotency and expired limiter windows; schedule bounded opportunistic cleanup rather than adding a workflow.
- [ ] Ensure an idempotency key is scoped to actor and operation, rejects a changed payload, and cannot duplicate writes under concurrency or crash recovery. Use transaction-backed operation RPCs where necessary; do not promise exactly-once semantics with an in-memory lock or a post-write response cache.
- [ ] Run focused tests and hosted rolled-back verifier for double migration, permissions, concurrent limiting, duplicate mutation and payload mismatch. Apply only required migrations in numeric order and verify schema. Commit with evidence.

### Task 4: Close OAuth access bypasses before token issuance

**Files:** Modify `lib/supabase/{session-user,middleware}.ts` and authenticated route guards as identified by Task 1; add a numbered restrictive-policy/RPC migration; create `tests/developer-oauth-boundary.test.ts` and extend `scripts/verify-developer-access.ts`.

**Interfaces:** `requireFirstPartySession(request: Request, write: boolean): Promise<User | null>` rejects verified OAuth-client tokens on website-only operations. MCP uses its dedicated verifier, never this helper.

- [ ] Write tests for OAuth client JWTs reaching old routes, private table reads/writes, Storage, exposed RPCs and Realtime. Assert ordinary sessions still support each existing operation.
- [ ] Run focused tests, confirm denied cases currently fail where bypasses exist.
- [ ] Add restrictive policies and internal function checks identified in Task 1. Preserve anonymous/public catalog behavior needed by the UI, while ensuring it cannot reveal private data. Explicitly document that the premium developer API does not turn previously public UI catalog routes into private data.
- [ ] Verify with hosted synthetic users/clients and rolled-back DB writes, then apply and reverify the required migration. Commit only after first-party behavior is preserved.

### Task 5: Build key/client settings and consent UI

**Files:** Create `app/api/developer/{keys,clients}/route.ts`, `components/developer-settings.tsx`, `app/oauth/consent/page.tsx`, `components/oauth-consent.tsx`, `app/api/oauth/decision/route.ts`; modify `components/settings-modal.tsx`, existing auth redirect helpers as needed; create focused unit and e2e cases.

**Interfaces:** Session-only key list/create/revoke and MCP grant list/revoke. Key creation returns `{ key, metadata }` once; all lists return metadata only. Consent uses verified Supabase authorization details, the permission allowlist and Task 1's proven grant binding.

- [ ] Read mobile, overlay, Next.js and UI craft skills; read the bundled Next.js guides for the affected page/session APIs. Fetch current Supabase consent docs with Context7.
- [ ] Write tests for user isolation, free-user creation denial but revocation allowed, CSRF, manipulated redirect/client details, deny producing no grant, and preserving authorization through login.
- [ ] Run focused unit tests and confirm failures, implement session-only administration with bounded JSON bodies and same-origin write checks.
- [ ] Build lazily loaded Settings content with clear copy, secret shown once, explicit expiry and revoke/rotate actions. Build consent showing actual client/host and explicit read/write/sharing/partner permissions. Follow the existing overlay primitive if adding any sheet/dialog.
- [ ] Verify focused e2e at 375/390/430 in browser and standalone inset modes, no overflow, >=36px targets, every required dismissal path, approval/denial/login and missing-entitlement states. Commit after focused checks pass.

### Task 6: Deliver paginated catalog and R2-only serializers

**Files:** Create `lib/server/operations/catalog.ts`, `lib/server/developer-images.ts`, `lib/developer-api/pagination.ts`, `tests/developer-catalog.test.ts`, `tests/developer-images.test.ts`; reuse `lib/tcg-mirror.ts` and existing image key helpers.

**Interfaces:** `listCatalogCards(input: CatalogQuery): Promise<Page<ApiCard>>`, `getCatalogCard(id: string, language: CardLanguage): Promise<ApiCard | null>`; equivalent bounded list/get operations for series, sets, Pokémon and illustrators. `resolveDeveloperImage(input: CardImageReference): Promise<{ url: string | null; availability: 'available' | 'missing' | 'unavailable' }>` verifies R2 only. Define `CatalogQuery`, `ApiCard` and `CardImageReference` next to their schemas.

- [ ] Write tests for >1000 synthetic records, identical collector sort values, aliases, language fallback, Unicode names, missing card data and maximum page size. Use opaque validated cursors with a unique final sort key and query binding.
- [ ] Test R2 misses, store outage, private buckets and malicious/legacy nested image URLs. Assert no upstream fetch, redirect or origin URL in serialized results.
- [ ] Run tests to confirm failures, then implement allowlisted catalog filters and DTO projections from stored fields, reusing canonicalization/correction logic. Include image availability and attribution without exposing provider raw payloads.
- [ ] Reuse existing R2 object keys with bounded concurrent reads. Preserve all catalog records when images are missing; no request-driven backfills. Verify bounded hosted pagination and R2 reads, then commit.

### Task 7: Share binder, collection and wanted operations

**Files:** Create `lib/server/operations/{binders,collection,import}.ts`, update `app/api/{binders,collection,collection-import/resolve}/route.ts` to call them; create `tests/developer-collection.test.ts`.

**Interfaces:** Typed operations accept `OperationContext` and validated inputs. Reads resolve current owner/binder access. Updates/deletes require a base fingerprint; writes reuse the atomic collection save and existing wanted assignment rules. Create operations require an idempotency key.

- [ ] Write tests for cross-owner IDs, partner departure, stale fingerprint conflicts, wanted-person validation, last-binder denial, populated-binder confirmation and duplicate create retries.
- [ ] Run tests and confirm failures. Extract logic without duplicating rules or changing legacy UI payload compatibility.
- [ ] Implement paginated collection reads/export and wanted mutations; retain acquisition notifications and collector tracking. Reject stale writes atomically rather than checking then writing without CAS.
- [ ] Apply R2 serializers to all returned nested printing images. Run focused existing binder/collection tests plus the new tests, verify partner changes between calls are enforced, and commit.

### Task 8: Share appearance, identity, settings, sharing and partner operations

**Files:** Create `lib/server/operations/{appearance,identity,settings,sharing,partners}.ts`; adapt their existing API handlers and `hooks/use-partner.ts`; create `tests/developer-management.test.ts`.

**Interfaces:** Context-aware functions mirror the exact operations in Task 1's coverage checklist. Account identity stays actor-scoped; collection settings stay owner-scoped. Partner and share changes require their separate management permissions.

- [ ] Write tests asserting partners cannot edit owner-only slugs or widen sharing, one actor cannot manage another's credentials, invitation acceptance binds to the intended recipient, and retries do not create duplicate invitations.
- [ ] Run tests, confirm failures, and extract existing validation/name reservations/ownership rules into shared operations. Add bounded authenticated binary upload handling preserving current size/type limits and private ownership checks.
- [ ] Adapt browser callers only where necessary to use the shared operations. Preserve named/token share revocation and existing redirects. Run focused relevant tests, then commit.

### Task 9: Share prices, comparisons, analytics, show purchases and deal calculations

**Files:** Create `lib/server/operations/{prices,comparisons,analytics,show-purchases,deal-check}.ts`; adapt current price/comparison/analytics API handlers and `hooks/use-show-purchase-sync.ts` as needed; create `tests/developer-tools.test.ts`.

**Interfaces:** Context-aware read/refresh/job operations preserve current provider constraints; `evaluateDeal` wraps existing pure calculations without inventing prices. Show purchase writes preserve `(owner_user_id,client_id)` idempotency and owner/member scope.

- [ ] Write tests for unsupported language/finish, absent/low-confidence prices, stale evidence, refresh cooldowns, job duplicates/cancellation, cross-owner show purchases and purchase retry/undo.
- [ ] Run tests to confirm failures, extract services and retain existing provider limits and workflow semantics. Keep long-running work as bounded job start/status/cancel operations, not one blocking MCP request.
- [ ] Run focused existing pricing/comparison/show tests and new tests; verify current DB/provider contracts without speculative live refreshes. Commit after pass.

### Task 10: Expose REST and publish the contract

**Files:** Create `app/api/v1/` handlers for all checklist operations, `lib/server/developer-access/principal.ts`, `lib/server/developer-api-response.ts`, `public/openapi.json`, `docs/public-api/{openapi,usage}.md`, `tests/developer-rest.test.ts`; modify `proxy.ts` and `public/sw.js` only as required.

**Interfaces:** `requireRestContext(request: Request, required: readonly DeveloperPermission[], kind: 'read' | 'write'): Promise<OperationContext>` rejects non-key credentials, verifies key/current entitlement, consumes actor budget, and supplies request id. Routes call Tasks 6–9 services. Error body: `{ error: { code, message, requestId } }`.

- [ ] Write handler contract tests for cookie-only/OAuth rejection, key success, 401/402/403/404/409/422/429/503, body limits, idempotency and no-store. Pin schemas against the coverage checklist and OpenAPI methods/paths.
- [ ] Run tests, confirm failures, then implement thin handlers and the shared response adapter. Cap JSON bodies at 64 KiB outside the separately bounded existing upload flow. Document each method, schema, pagination, permission and retry behavior.
- [ ] Avoid browser-session refresh/redirect work on bearer routes. Exclude authenticated endpoints and consent navigation from SW fallback/cache handling, including extension-shaped URLs. Keep offline binder queues intact.
- [ ] Verify focused service-worker/auth regressions and synthetic end-to-end REST flows for read/write/revoke/expiry/R2 provenance. Commit with exact coverage totals.

### Task 10a: Serve developer documentation with Fumadocs

**Files:** Add `app/docs/[[...slug]]/page.tsx`, `app/docs/layout.tsx`, `content/docs/`, a scoped documentation source and Fumadocs configuration; modify `next.config.mjs`, package dependencies and lockfile.

**Interfaces:** Public `/docs` and `/docs/*` proxy to the source `/app/docs` routes. Fumadocs reads the same OpenAPI contract as Task 10. Keep provider/styles scoped so binder routes do not load documentation UI.

- [ ] Use current Fumadocs docs from Context7 and read bundled Next.js docs before integrating. Wrap the existing workflow config rather than replacing it.
- [ ] Create onboarding, API keys, MCP OAuth, permission, pagination/rate-limit, image availability, errors and operation reference pages. Show implemented operations accurately while the rest remain disabled.
- [ ] Add focused route/link tests for both source and public docs paths, search, assets, code examples and mobile navigation. Verify all required phone/PWA widths without a full e2e run.
- [ ] Verify deployed origin docs, then merge/publish the staged Framer docs rewrites and verify public `/docs`. Framer is currently limited to six rewrites: `/api` and `/auth` aliases remain blocked; retain existing `/app/api` and `/app/auth` and report the capacity gate. Do not remove existing rules or purchase an upgrade.
- [ ] Commit this documentation concern independently and release under the standard checks.

### Task 11: Expose OAuth MCP and discovery

**Files:** Create `app/mcp/route.ts`, `lib/server/mcp/{auth,metadata,tools,server}.ts`, protected-resource metadata route/rewrites established by Task 1; update `.env.example`, `docs/app-routing.md` and usage docs; create `tests/developer-mcp.test.ts`.

**Interfaces:** `requireMcpContext(request: Request, required: readonly DeveloperPermission[], kind: 'read' | 'write'): Promise<OperationContext>` verifies Task 1's issuer/audience/grant binding and rejects keys/cookies/ID tokens. Tool adapters call the same Tasks 6–9 services with bounded schemas and truthful destructive/read-only annotations.

- [ ] Fetch current supported MCP SDK transport/auth documentation via Context7 and select a pinned compatible version. Write tests for discovery challenge, wrong issuer/audience/client, revoked or old-generation grants, session isolation, auth on every tool call and API-key rejection.
- [ ] Run tests and confirm failures. Implement stateless Streamable HTTP and standards-compliant discovery/error handling, preserving cancellation and bounded job operations. Never put actor identity in process-global state or pass client tokens downstream.
- [ ] Verify advertised discovery through Framer and origin; if a root well-known path needs an external routing change, record and perform that exact configuration using available authorized tools, otherwise report the concrete access blocker.
- [ ] Connect an actual compatible MCP client and prove login, consent, discovery, read, allowed write, denied write, refresh, revoke and reapprove without reviving an old JWT. Enable hosted OAuth only after Task 4 protections and consent deployment are verified. Commit with redacted evidence.

### Task 12: Complete coverage and ship

**Files:** Update `docs/public-api/{coverage,oauth-proof,usage}.md` and this plan; fix only identified gaps in prior task files.

**Interfaces:** Consumes every prior task's contracts. Produces a complete operation checklist, merged PR links and verified production commit, or explicit remaining blockers.

- [ ] Audit each UI data operation against REST/OpenAPI/MCP. Every included operation has implementation and focused verification; exclusions match the approved design. Mark uncovered features incomplete rather than silently dropping them.
- [ ] Run the focused security/parity suites and required local checks. Run mobile/standalone checks for Settings and consent; use focused offline cases proving no lost queued edits and no private service-worker cache. Do not run full e2e.
- [ ] Request an independent whole-change review of auth boundaries, stale tokens, data isolation, pagination, image provenance and all stated review-focus cases; address findings before release.
- [ ] Ship each ready concern through the release skill: commit, push once, open and link PR, enforce Typecheck, Vercel and reviews, merge exact verified head. Use the documented quota exception only for verified quota failures with all four local checks passed. Use the PR watch tool if waiting, not polling loops.
- [ ] Verify hosted migrations, feature settings, public discovery/consent, real key REST read/write/revoke, real MCP connection and R2-only image provenance against the production commit. Report merged-but-deployment-pending separately from production success.

## Self-review

All approved spec sections map to Tasks 1–12. Review Focus cases map respectively to Tasks 1/3/11, 2/7/9, 6, 6/7 and 1/4. Shared permission/context names are consistent across both transports. OAuth implementation remains dependent on hosted proof; no unsupported token-binding mechanism is silently assumed. Existing dirty files are excluded from commits. This is one cohesive project with separately shippable concerns, not a single quota-heavy branch push sequence.


2026-11-08 approved clarification: private user-uploaded binder artwork also moves to a separate private R2 bucket. Share the owner-authorized signed-upload/download service across UI, REST and MCP. Copy and hash-verify existing Supabase artwork before cutover; retain source objects for rollback. No upstream or Supabase image-serving fallback. See docs/public-api/private-artwork.md.
