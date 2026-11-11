# Inventory and collection navigation

The current production app/bootstrap contract, first-default prerequisite and direct-cutover boundaries are maintained in [Authenticated BinderApp browser host](binder-browser-host.md). It replaces the historical staged admission and old-client rollout requirements below. Parent owns conversion, hosted acceptance and deployment.

## Delivered boundary

`components/collection-navigation/navigation-host.tsx` owns presentation and history around the reusable `InventoryView`. The authenticated host supplies its current scope, bound evidence, a fresh-read callback and collection/National Dex render adapters. Its header independently selects a named collection and Binder/List presentation; Inventory is a direct main destination, defaults to All storage and retains its visible Storage filter. National Dex is reachable. Slabs uses the existing renderer in the authenticated and cached host.

`lib/collection-navigation.ts` whitelists device-local main view, selected collection, per-collection Binder/List/page/search/scroll, Inventory query/window/scroll and Dex scroll. These preferences live only in localStorage under the signed-in account plus resolved owner, never an owner-wide synchronized preference or public layout. Authentication lifecycle `sessionId` is deliberately not persisted: rotate it on sign-out, account/membership changes and unlink/relink, including a return to the same IDs. The keyed private host remounts and discards in-flight reads and transient UI. Cached JSON and browser history are untrusted presentation, never proof of identity/access.

No overlay, edit session, drag, selected slot, bulk selection, highlight, opaque cursor or private certificate is saved. Browser back/forward uses scoped entry IDs, distinguishes shared-overlay history cleanup from a real destination traversal, and restores the outgoing search/scope/window/scroll. Navigation closes overlays with `closeAllOverlays`, waits for the closing commit and uses `runAfterOverlayHistory`; an overlay's delayed history pop cannot cancel a fresh read or undo the next destination. The shared primitive explicitly identifies cleanup popstate events both before and after flushing deferred pushes, so the host ignores those events regardless of listener registration order. Normal navigation keeps its existing timing. Collection/view changes unmount the adapter's transient UI. Committed and queued edits belong to the external session/queue and are never removed by this host.

Inventory accepts `initialBrowseState` and `onBrowseStateChange` for query/window restoration. The list grows 40 copies at a time as it scrolls; `inventoryWindowRows` returns every row through the restored window from the safe index in one sort, rather than persisting cursors. Changed data/filters clamp the window to current matching copies. Existing callers retain their default reset behavior.

Explicit `?binder=…&page=…`, `view`, `slot` and `item` links beat saved state. A current item/slot link resolves page/highlight from stable IDs and verified revision/grid evidence. Empty target/spacer links locate their stable slot without inventing an owned item; unavailable slot links retain a usable collection with an explanation. Missing/inaccessible/uncached collections use available storage; missing storage filters reset to All storage. A cached subset never proves complete order or a current slot/page. The local adapter shows a cached-collection notice instead of guessed pages.

## Authenticated host contract and trust boundary

The exported `CollectionNavigationRead` is an **in-memory private capability input**, not an HTTP/RSC/REST/MCP schema. Its scope contains the authenticated account, resolved owner and current session lifecycle ID. `navigationIndex` requires an exact match for all three against the current host scope, validates the snapshot and rejects an unbranded complete payload. A linked partner needs freshly authorized evidence bound to their own account and the shared owner. Same-owner evidence from another account/session is rejected. A caller setting matching strings is not authentication; only the eventual authenticated transport can establish that envelope.

`readCurrent(): Promise<CollectionNavigationRead>` must invoke the real current-session complete reader and recheck current actor/membership/billing before returning, bind the current session ID, and return verified catalog/grid evidence at the exact layout revisions. It cannot reuse retained command ledger results, callback coordinates or a saved UI snapshot. On every Open location, the host awaits this callback and calls `navigationLocation` against its returned evidence. A moved copy opens its new collection/page/slot; missing, Unassigned, cached, inaccessible, layout-unknown and failed-refresh cases keep Inventory usable with an honest message. Obsolete scope/destination responses are ignored.

The actual current-session callback is now
`readCurrentCollectionNavigation(liveScope)` in
`lib/collection/inventory-navigation-read.ts`. Pass `() =>
readCurrentCollectionNavigation(liveScope)` as `readCurrent`; explicit initial
complete/conflict/unavailable handling is available through
`fetchCurrentCollectionNavigationRead`. It invokes #435's same-origin private
browser reader, reconstructs completeness through the shared complete reader and
binds account/owner/lifecycle scope plus the fenced grid/catalog evidence.
Failures preserve status/code and the existing host refresh-failure path; cached
subsets are never upgraded. The adapter rechecks live scope after the browser read.
The actual BinderApp caller uses checked authenticated admission; see [the binding contract](binder-browser-host.md). Endpoint admission belongs to the server lane.

See [the complete-read contract](inventory-complete-read.md) for private v2 wire,
083 location/source preservation, catalog batching and metadata fences. Grids come
from actual current per-binder overrides and owner settings/defaults.
086's narrow authenticated `inventory_grid_read_v1()` supplies inherited owner
grids without widening the owner-only settings RLS. The reader validates and fences
its minimal projection, then the existing actual browser/navigation adapter resolves
partner stable-ID pages. Before 086 is installed, inherited partner grids remain
safely unknown; explicit binder grids still work. See the complete-read contract
for permissions, fallback and local proof limits. Lifecycle binding and cached-only bootstrap use the checked production app host. Catalog unknowns remain unknown.

## API, audit and release

Navigation preferences and browser history are device-only UI, so no REST/MCP operation, shared operation, permission, OpenAPI schema or generated API page changes. The existing public operation registry and generated discovery remain unchanged. Supported inventory/slot data read/write parity and its actual authorization/projection/errors remain tracked under #376/#379. This read-only host writes no card/target/order/grade/location data and emits no audit/recovery event. 086 adds only the narrow read RPC, with hosted application reserved for the parent. No hosted data write was performed in this lane.

The local-only existing Inventory harness adds `?navigation=1`; the same E2E plus loopback/non-hosted gate applies. It uses synthetic owner/partner/copies, the real Inventory view/detail, shared OrderedSlot, LayoutToolbar and existing DexListView with missing Pokémon. Layout intent callbacks deliberately do not save anything. This proves navigation teardown around actual staged controls; it does not prove queue replay, Undo, mutation persistence, full drag/bulk editing or complete BinderApp integration. The actual BinderApp uses the same host in authenticated production sessions; the separate harness remains synthetic. An independent browser/device starts with empty navigation storage; profiles do not synchronize.

[Unpublished release copy](releases/collection-navigation-draft.md) belongs to the eventual enabled #386/#379 block. No live feature/help/Framer link or shipped claim exists for this hidden slice. Parent owns review, merge, migrations/backup if required by other PRs, deployment and enabled production verification.

## Parent-owned release gates

Server endpoint admission, operator conversion, review/merge/deploy and production verification remain parent-owned. The browser does not convert existing owners. No old-client coexistence or zero-downtime rollout is required for this direct cutover.

## Verification

`tests/collection-navigation.test.ts` exercises whitelisted restoration, deep-link precedence, legacy binder URLs, scope/session/owner changes, missing/uncached fallback, JSON-brand rejection, fresh moved/removed/Unassigned locations, data immutability and rebuilding paginated windows beyond 1,000 copies. Existing Inventory and actual server-reader tests remain relevant independent proof of projections and authorization, not enabled browser transport.

`e2e/collection-views.e2e.ts` exercises real components in the staged host across 375×667, 390×844 and 430×932 browser/standalone profiles with 59/34px insets. It covers Inventory→current location→back/forward with query/scope/window/scroll, relaunch/reload/deep links, moved/failed fresh reads, stale account evidence, signed-out teardown, Edit layout teardown, cached offline switching, National Dex Missing and dock geometry. Affected `e2e/inventory.e2e.ts` covers the unchanged browse behavior and all shared-sheet dismissals. No full e2e or physical-device/installed-PWA, authenticated offline reload or production flow is claimed. Exact final commands/counts belong in the PR.

Local source verification: 39 focused unit tests across collection-navigation, inventory-query and inventory-server-read; 60 affected Playwright cases across all six phone projects using port 3396 and two workers; full typecheck; focused ESLint with zero warnings; full lint at the unchanged 55-warning cap; production-mode harness build and docs CSS verification. No full e2e suite.

Parent review reproduced the private-host-remount overlay/dock race on the original source. The shared primitive now identifies cleanup pop events before or after its listener flushes deferred pushes, and the host ignores them without changing normal navigation timing. Final integration passed 46 focused units, 66 affected phone cases with no retries, typecheck, focused zero-warning lint and the production-mode E2E build. No full e2e or hosted data writes.

The actual BinderApp/dock lifecycle binding and its precise admission/transport/offline gaps are now documented in [BinderApp browser host binding](binder-browser-host.md). Endpoint admission is implemented by the server lane; the earlier standalone harness remains useful isolated navigation evidence.
