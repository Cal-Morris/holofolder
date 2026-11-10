# Authenticated BinderApp browser host

Related: #379/#386. This is the app/bootstrap lane for direct native cutover. Parent owns hosted backup/conversion, review, merge, deployment and Framer. The browser never converts existing owners, and this change does not activate an old-client fence.

## Entry and authority

Signed-in private `BinderApp` enters `BrowserCollectionSession` before mounting the UI surface. The writable legacy `useCollection` lifetime is absent. The rendered UI uses read-only legacy hooks, with native controls bound to the existing canonical IndexedDB queue and sender. Legacy rows, queues and cached DTOs cannot authorize native edits or replay.

`useBrowserCollectionScope` checks current JWT subject, authenticated role, absence of developer `client_id`, auth session ID, current membership and strict partner billing. Its owner comes from that check, not the bootstrap or device marker. Authentication, account, membership, focus and reconnect events invalidate the previous lifetime before asynchronous checks. The current-scope getter fences old reads, callbacks and sends. Owner changes open a new scoped session; failed checks show a retained-state notice with retry/sign-out instead of reopening writable legacy UI.

`browserHostAdmission` distinguishes authenticated-session from synthetic-local-only evidence. The synthetic server-gated loopback harness always selects synthetic endpoints. Production endpoint selection requires the checked scope. Admission opens a host only: editing still needs the actual private/no-store JSON-v2 HTTP response reconstructed through the complete reader in the current scope.

The production bootstrap loads display settings/layout without reading legacy collection rows. A local native startup pointer can reach canonical IDB startup without a legacy row snapshot. It remains a display pointer, never session or complete-read authority.

## Selection and retained state

Explicit binder/page/slot/item/view links override device presentation. Without a saved view, the complete read's `defaultCollectionId` is preferred, then a validated boot binder or available storage. Account/owner-scoped navigation retains collection, Binder/List/Slabs presentation, page, searches and scroll on this device. Owner changes never reuse another owner's navigation or queue.

The existing Inventory, scanner, grading, creation, backup/restore and recovery bindings remain session-owned. Leaving a view removes transient editing and overlays while preserving committed local intent. Slabs uses the existing renderer. National Dex and its secondary browse surfaces remain read-only; native card consumers own writes.

Failed complete reads retain saved copies and pending intent, show a clear notice and downgrade previous complete evidence to cached-only. New edits and the automatic sender require a successful complete read in this lifetime. Refresh storage retries explicitly. A receipt alone is never an ACK; the existing sender must perform its separate fresh complete read. Existing unknown-outcome/recovery rules and original operation IDs remain unchanged.

## New owner / first default

Migration 083's `create_collection_v1` already supports first storage: revision defaults to zero, it inserts `inventory_owner_state` if absent, and `binder_count=0` sets `is_default`. The browser now uses the same creation draft/queue/sender with a genuinely empty **branded complete read**; it no longer requires an existing collection/binder. Confirmed creations open only after the normal receipt and fresh complete-read reconciliation. Cached or fabricated empty JSON still fails.

There is one server prerequisite: `readTrustedInventoryState.revision()` currently returns `inventory_not_initialized` when `inventory_owner_state` is absent, before a browser can obtain its planning base. The server lane must provision an initialized empty native owner for a genuinely new account, or provision its first default through 083 before bootstrap. Establish absence of existing legacy binders/rows server-side, preserve transactional scope/audit rules, and never auto-convert an existing owner. Once an empty complete response is available, New storage is usable and 083 chooses the first default. Mixed/legacy owners remain `legacy_inventory_incomplete`; the app retains state and explains that operator conversion is needed.

## Minimal server-lane contract

- `GET /app/api/inventory?requestId=…&sessionId=…`: existing private/no-store v2 envelope, current actor/owner/auth/lifecycle scope, independently fenced complete counts/revisions, navigation catalog/grids and unique default collection ID when known. New owners need the prerequisite above.
- Existing POST contracts remain unchanged: `/app/api/binder-slots`, `/app/api/inventory`, `/app/api/storage-collections`, `/app/api/raw-content-restore` and native recovery. Keep receipt/rejection headers and family/operation/session identity used by current senders.
- Scope mismatch, access failure, mixed legacy/native state and incomplete reads stay failures. No cached JSON, retained command response or synthetic admission can become an authenticated complete read.
- REST/MCP admission and public sharing remain the server lane's responsibility. Device navigation has no REST/MCP mutation or audit event. No API registry or generated OpenAPI changes belong to this lane.

## Offline and verification boundary

The existing cached startup path now applies to production. It still requires the same unexpired device account/session pointer, exact saved scope and partner billing-cache allowance, canonical queue baseline/optimistic state and validated grid metadata. It displays Cached only and exposes no command acceptance, replay or ACK. Reconnect closes cached display and checks live access. Missing/expired/corrupt evidence retains pending bytes and asks for a connection. No per-user HTML is cached and no queue/storage identifiers change.

Focused units cover admission, bootstrap, local startup, lifecycle, complete-read transport and first creation. `e2e/native-production-bootstrap.e2e.ts` exercises the actual app host and production endpoint selection with synthetic remote/auth evidence across six phone modes. `e2e/native-startup.e2e.ts` uses the real production-built worker and genuine page-close/offline relaunch. These checks are not hosted SQL/RLS, real-device installed-PWA or production deployment proof. Parent retains those gates. Release copy remains [unpublished](releases/binder-browser-host-draft.md).
