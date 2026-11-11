# Authenticated BinderApp browser host

Related: #379/#386. This is the app/bootstrap lane for direct native cutover. Parent owns hosted backup/conversion, review, merge, deployment and Framer. The browser never converts existing owners, and this change does not activate an old-client fence.

## Entry and authority

Signed-in private `BinderApp` enters `BrowserCollectionSession` before mounting the UI surface. The writable legacy `useCollection` lifetime is absent. The rendered UI uses read-only legacy hooks, with native controls bound to the existing canonical IndexedDB queue and sender. Legacy rows, queues and cached DTOs cannot authorize native edits or replay.

`useBrowserCollectionScope` checks current JWT subject, authenticated role, absence of developer `client_id`, auth session ID, current membership and strict partner billing. Its owner comes from that check, not the bootstrap or device marker. Sign-out, a different account and local membership changes invalidate the previous lifetime synchronously, before asynchronous checks. Focus, reconnect and same-account Supabase events (which repeat `SIGNED_IN`/`TOKEN_REFRESHED` on every tab refocus) recheck in the background: the open scope, its session and its reads stay mounted unless the check proves the account, owner or auth session changed, which then opens a new scope. A dropped connection during such a recheck keeps the open collection; a definitive auth, membership or billing failure closes it. The current-scope getter fences old reads, callbacks and sends. Owner changes open a new scoped session; failed checks show a retained-state notice with retry/sign-out instead of reopening writable legacy UI.

`browserHostAdmission` distinguishes authenticated-session from synthetic-local-only evidence. The synthetic server-gated loopback harness always selects synthetic endpoints. Production endpoint selection requires the checked scope. Admission opens a host only: editing still needs the actual private/no-store JSON-v2 HTTP response reconstructed through the complete reader in the current scope.

The production bootstrap loads display settings/layout without reading legacy collection rows. A local native startup pointer can reach canonical IDB startup without a legacy row snapshot. It remains a display pointer, never session or complete-read authority.

## Startup and layout

The complete read starts as soon as the scope is checked, in parallel with this device's saved queue and metadata; the saved copy only fills an empty view and never replaces a server read. Until the first read finishes online, the binder skeleton shows. Focus and reconnect skip a refresh while one is already in flight, so a slow read is not restarted on every refocus.

The native host uses the normal app header (title, page controls, Show, More with Settings, National Dex, Analytics and Sign out) and one compact row: collection picker, Binder/List/Slabs view, Scan page/card icons and a **Storage** menu. Storage holds Activity, Backup, New storage, Delete collection, Refresh storage, the saved checklist scope and synchronized-change review. Storage totals live in Analytics, not above the binder. Status lines appear only while something needs attention (pending sync, conflicts, recovery, refresh failure).

## Selection and retained state

Explicit binder/page/slot/item/view links override device presentation. Without a saved view, the complete read's `defaultCollectionId` is preferred, then a validated boot binder or available storage. Account/owner-scoped navigation retains collection, Binder/List/Slabs presentation, page, searches and scroll on this device. Owner changes never reuse another owner's navigation or queue.

The existing Inventory, scanner, grading, creation, backup/restore and recovery bindings remain session-owned. Leaving a view removes transient editing and overlays while preserving committed local intent. Slabs uses the existing renderer. National Dex and its secondary browse surfaces remain read-only; native card consumers own writes.

Failed complete reads retain saved copies and pending intent, show a clear notice and downgrade previous complete evidence to cached-only. New edits and the automatic sender require a successful complete read in this lifetime. Refresh storage retries explicitly. A receipt alone is never an ACK; the existing sender must perform its separate fresh complete read. Existing unknown-outcome/recovery rules and original operation IDs remain unchanged.

## New owner / first default

Migration 083 originally supported first storage with a revision-zero planning base, inserting `inventory_owner_state` and choosing the first default. Migration 093 superseded its missing-root behavior: creation now rejects an absent root with `storage_owner_state_unavailable` before that insert is reachable. Parent-owned migration 098 is required to initialize a proven-empty owner root inside the trusted locked creation wrapper while preserving 093 terminal proofs and replay. The browser now uses the same creation draft/queue/sender with a genuinely empty **branded complete read**; it no longer requires an existing collection/binder. After that prerequisite, confirmed creations open only after the normal receipt and fresh complete-read reconciliation. Cached or fabricated empty JSON still fails.

`readTrustedInventoryState` now admits an absent root as a complete revision-zero planning base only after authenticated, owner-scoped exact counts prove zero binders, legacy `pokemon_collection` rows, storage state, items, slots, placements and source mappings. Query errors, missing tables/counts, denied access and any residue fail closed. The existing claims/server-session/membership/billing and final freshness fences still apply. Root absence is fenced separately from revision zero, so concurrent first creation conflicts/retries even if its root is revision zero. GET performs no provisioning or mutation. The browser submits the existing creation contract at revision zero, but first creation remains blocked until parent-owned 098 supplies the trusted locked root prerequisite. This PR adds no SQL, grants or implicit provisioning. Existing nonempty/mixed/legacy owners still need parent-owned conversion, never implicit initialization through GET.

## Minimal server-lane contract

- `GET /app/api/inventory?requestId=…&sessionId=…`: existing private/no-store v2 envelope, current actor/owner/auth/lifecycle scope, independently fenced complete counts/revisions, navigation catalog/grids and unique default collection ID when known. Untouched new owners use the proven-empty revision-zero path above.
- Existing POST contracts remain unchanged: `/app/api/binder-slots`, `/app/api/inventory`, `/app/api/storage-collections`, `/app/api/raw-content-restore` and native recovery. Keep receipt/rejection headers and family/operation/session identity used by current senders.
- Scope mismatch, access failure, mixed legacy/native state and incomplete reads stay failures. No cached JSON, retained command response or synthetic admission can become an authenticated complete read.
- REST/MCP admission and public sharing remain the server lane's responsibility. Device navigation has no REST/MCP mutation or audit event. No API registry or generated OpenAPI changes belong to this lane.

## Offline and verification boundary

The existing cached startup path now applies to production. It still requires the same unexpired device account/session pointer, exact saved scope and partner billing-cache allowance, canonical queue baseline/optimistic state and validated grid metadata. It displays Cached only and exposes no command acceptance, replay or ACK. While initial checked claims/membership are pending or stalled, including when `navigator.onLine` is true, the waiting host can display the same validated cached-only reader while live scope resolution continues. Auth/membership invalidation and expiry close it; checked scope resolution automatically replaces it with the current-read host. Reconnect closes an already cached view before checking live access. Missing/expired/corrupt evidence retains pending bytes and asks for a connection. No per-user HTML is cached and no queue/storage identifiers change.

Focused units cover admission, bootstrap, local startup, lifecycle, complete-read transport and first creation. `e2e/native-production-bootstrap.e2e.ts` exercises the actual app host and production endpoint selection with synthetic remote/auth evidence across six phone modes. `e2e/native-startup.e2e.ts` uses the real production-built worker and genuine page-close/offline relaunch. These checks are not hosted SQL/RLS, real-device installed-PWA or production deployment proof. Parent retains those gates. Release copy remains [unpublished](releases/binder-browser-host-draft.md).

## First-creation hosted prerequisite

Parent API smoke through Framer returned `503 storage_unavailable` with zero binders and zero receipts. The rollback-only diagnostic returned SQLSTATE `55000 storage_owner_state_unavailable`, traced to 093's missing-root guard. Evidence: parent-private `pr507/first-creation-diagnostic.redacted.json`. Parent reports both failed fixture groups fully cleaned and no actual conversion. This follow-up performs no hosted access or SQL. Migration 098 belongs to a separate parent lane; successful mocked browser creation is not hosted creation proof. Parent must apply/verify 098, rerun first creation and verify the exact deployed server/session and 097 reorder behavior before acceptance.

## Corrective follow-up proof

The original client at `6b5328d95e092fa9e80c0adf282ba42caf46373f` reproduced the P1 with `navigator.onLine=true`, a real persisted canonical pending layout and a held partnership response: it remained on Checking your account without showing saved storage. The corrected host has one cached reader, keeps checked resolution running, accepts no cached commands and preserves the entire canonical queue through pending, failed, recovered and invalidated scope checks.

`E2E_BASE_URL=http://localhost:3318 bun run test:e2e:matrix e2e/native-production-bootstrap.e2e.ts e2e/native-startup.e2e.ts --workers=2` passed all 132 cases across 375/390/430 browser and emulated standalone modes, using a production build, actual app/worker/IndexedDB and synthetic auth/catalog/backend responses. The expiry refusal test permits either checked-host or cached-reader rejection and requires both absence of cached private UI and unchanged queued intent.

134 focused unit tests passed across host admission/catalog, membership lifecycle, server/HTTP/browser complete reads, native startup and first-storage planning/queue contracts. Empty-owner tests prove HTTP-to-browser reconstruction at revision zero without writes, refuse residue in each required table and failed/denied/missing-table/count/network reads, and reject changed scope or concurrent root/first creation. `bun run typecheck`, `bun run lint` (51 existing warnings, no new warnings) and `bun run build` passed. No full e2e suite, hosted access, SQL or conversion was performed. Physical installed-PWA and hosted 098/first-creation verification remain parent-owned; mocked creation does not waive those gates. Route/session admission and 097 reorder SQL were not changed here.

## Superseded startup reads

Each browser-session refresh owns an abort controller. Replacing a read, changing the checked session or unmounting the host cancels the old HTTP request, including its response body. The latest successful refresh completes startup; an intentionally superseded initial read does not trigger cache reset while its replacement is still running. The existing one-reset startup recovery remains for actual failure. This is internal lifecycle behavior, with no public REST/MCP schema change.
