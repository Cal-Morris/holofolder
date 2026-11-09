# Read-only Inventory browse preparation

Related: #385, #386. This is an internal reusable view with a local synthetic harness, not an enabled production Inventory mode. #379 owns enablement. Existing Binder/List/Dex navigation and links are untouched.

## Inputs and trust

`InventoryView` in `components/inventory/inventory-view.tsx` accepts the shared `InventoryBrowseScope`, `InventoryBrowseEvidence`, `InventoryCatalogEvidence` and `InventoryLayoutEvidence` contracts from `lib/domain/inventory-browse.ts`. These are view inputs, not another inventory store or transport/API schema.

The authenticated account ID and resolved owner ID are separate. A linked partner supplies their own account ID with the same resolved owner and sees the same whole-owner evidence. The view does not authenticate either field. A future authenticated host must resolve/recheck current membership and entitlement, clear prior evidence synchronously on account/owner changes, and supply only that scope's evidence. A foreign owner's snapshot yields unavailable, never rows from the old account.

Complete input requires the runtime `CompleteInventorySnapshot` brand from `lib/collection/slot-snapshot.ts`. `lib/server/inventory-read.ts` currently obtains it only after reading all owner streams, full ordered slot pages, counts and revision/membership fences. Plain JSON, casts and structural normalization cannot establish completeness. The server brand does not survive serialization; a future private client binding must validate/reconstruct complete evidence through the existing complete-read boundary with trusted scope, counts/revisions and fences. Do not mark arbitrary downloaded/cached JSON complete by feeding its own lengths back to that validator. No such authenticated binding is added here.

Unavailable, not initialized, incomplete legacy conversion, forbidden, revision conflict or deadline failures must remain unavailable, with a usable retry/fallback from the future host. They must not become an empty complete snapshot. Legacy owned collections are not falsely presented as zero inventory. A successful complete snapshot with zero items is the only complete empty state.

Cached input is a structurally valid saved subset, explicitly labelled **Cached only**. Counts/search cover that subset, not the owner's total. Missing placements are location unavailable, not proof of Unassigned. Even a saved assigned copy does not get a page derived from potentially partial cached order; only its saved collection is shown. This slice neither persists an offline index nor changes the canonical store, SW, queue or bootstrap. Filtering supplied cached evidence works without network, but authenticated offline reload/binding remains a #363/#379 gate.

## Rows and queries

`lib/inventory-query.ts` projects one row per physical inventory item ID, never per printing, certificate, target, want or showcase reference. Catalog identity and language associations must match supplied evidence. Missing or ambiguous evidence stays unknown. Real images use the shared `CardImage` component; unknown images remain unknown. Identity language/finish come from the copy and are never defaulted from another printing. Legacy species-only items remain identifiable by their recorded Pokémon number without inventing a catalog printing.

Search covers known name/species/set/number/catalog ID. Filters cover collection, assignment, raw/graded and exact recorded provider/grade. Default scope is All storage, including Unassigned in complete evidence. Sorting uses deterministic text keys plus item ID. Provider/scale/grade sorting groups recorded text, with no numeric conversion or cross-provider equivalence. All queries are pure and leave stored order, grades and assignments intact.

`queryInventory` returns a bounded window and an opaque local keyset cursor. Walks beyond 1,000 items retain distinct IDs and deterministic order; cursor identity belongs to an exact safe evidence key and normalized query. Equivalent host renders preserve the window; changed snapshot/layout/item revisions, safe display evidence or scope/query invalidate old cursors. The UI resets query/window/selection synchronously when its safe projection, scope, inventory revision or ordered layout revisions change. Callers must replace snapshot/evidence/catalog/layout objects immutably, not mutate existing props in place. Cursors and selections are not persisted or shared across accounts/devices.

The safe row projection deliberately excludes certificate, holder, label assets/variant, acquisition information and private links. They are absent from row labels, detail, filters and search. No grading provider is fetched or verified, and no slab/price is fabricated. Unknown grade is explicitly shown as such. Raw means the canonical item has no grading record.

## Location callback for #386

`resolveInventoryLocation` derives current position from the complete binder's current full slot order and verified per-collection rows/cols at its exact layout revision. There is no default grid. Missing/stale/ambiguous layout evidence gives the current position with layout unknown. Verified grid/reorder changes update the derived page/slot/row/column. No page is persisted as identity.

`onOpenLocation?: (intent: InventoryLocationIntent) => void` receives **only** `{ collectionId, slotId, itemId }`. The detail closes before the callback runs through `runAfterOverlayHistory`, so browser history cleanup cannot undo host navigation. The future host must re-resolve `itemId` against current authorized evidence using `resolveInventoryLocationIntent`, not blindly trust the originally emitted collection/slot or page. A moved copy resolves to its new collection/slot; Unassigned, removed and unavailable items require an honest fallback. Derived page/slot are optional presentation only. This harness reports the resolved destination; it does not claim a production page jump/highlight or back-to-Inventory restoration.

The [staged #386 host](collection-navigation.md) now supplies device/account/owner-scoped search/scope/window/scroll restoration, current stable-ID location refresh, history/deep links and `closeAllOverlays` integration around this reusable view. Production dispatch/authenticated browser binding remains gated by #379; the original standalone browse harness keeps its default behavior.

## Concrete next host bindings, not runtime APIs

The authenticated host needs `type RefreshAuthorizedInventory = () => Promise<CompleteInventorySnapshot>` using the current complete-read contract, explicit account/owner invalidation and a separate unavailable result path on read failure. It supplies resolved catalog evidence and verified collection layouts alongside the snapshot. This callback is not implemented/exported by the view and must not infer completeness from a cached subset.

The existing navigation callback is `type OpenInventoryLocation = (intent: InventoryLocationIntent) => void`; #386 implements re-resolution, page/highlight presentation and the scoped return context behind it.

For future mutation UI, the host can provide `type PreviewInventoryCommand = (request: InventoryCommandRequest) => void`, importing `InventoryCommandRequest` from `lib/domain/inventory-commands.ts`. It must build the exact versioned chosen-copy/destination preconditions from current complete evidence and show occupied-target consequences before handing the parsed request to the canonical command/queue lane. This is a preview callback, not a success/queue-acceptance ACK. Durable acceptance, retry/conflict, authenticated execution and audit/recovery results belong to that lane and must be integrated before any mutation control ships. #387 adds the real grading form against `GradingRecord`. No mutation callback or speculative control is exported here.

## Read-only, API and rollout boundary

No command submission, queue acceptance, assignment, move, removal, multiselect/bulk operation, Add owned, save/Undo, audit event, recovery, SQL migration or hosted write occurs. No REST/MCP registry/dispatcher/OpenAPI/grant is changed. Existing internal server reads and disabled command/API lanes are unchanged. The concrete API boundary is a private UI projection over supplied evidence, with an authenticated private read adapter still required before #379. The canonical command lane owns future mutation callbacks and audit/recovery, rather than this view inventing commands or a second store.

#385 remains open for its literal assignment/edit/removal/add/bulk/offline-index gates and real enabled ownership binding. #386 remains open for integrated navigation, page jump/highlight and restoration. #387/#390 own grading editing/slab presentation. The prepared [release copy](releases/inventory-browse-draft.md) is unpublished and must be reviewed against the eventual enabled capability. No Framer announcement applies to this hidden slice.

## Local proof surface

`/app/e2e-harness/inventory` is an isolated synthetic host. It requires `HOLOFOLDER_E2E=1`, a loopback Host, and absence of Vercel hosting indicators. The e2e flag cannot enable it on hosted production. It has no environment bypass for the host check and consumes no real account data. Even its complete fixtures pass the canonical completeness validator. The fixture certificates/grades/copies and stress catalog row are explicitly synthetic; the Charizard Base Set catalog metadata/image source is actual catalog evidence, intercepted during tests.

Run on the owned port 3524 with synthetic Supabase configuration, using a local production build and `E2E_BASE_URL=http://localhost:3524 bun run test:e2e:matrix e2e/inventory.e2e.ts --workers=2`. No full e2e suite, hosted services, provider purchases or publication are required.

Pure coverage: physical duplicates, privacy, exact filters, all five sorts across 1,205 copies, stale cursors/scopes, catalog ambiguity/language, empty/unavailable/cached distinction, current reorder/grid/move/unassign/delete locations and hosted harness rejection.

Affected UI matrix: `e2e/inventory.e2e.ts` runs at 375×667, 390×844 and 430×932, each browser and standalone with 59/34 px safe insets. It covers rows/filter/count/metadata, keyboard Open location, current order/grid, every shared-overlay dismissal (X, Escape, browser back, backdrop, swipe and host tab switch), focus/scroll unlock, 36 px targets, sheet/dock clearance, long text, light/dark overflow, cached offline filtering, empty/unavailable, linked partner/account switch and 1,205-item window traversal. Emulated phones are not physical-device testing. Browser-back exercises the shared Android-back history path; native Android/iOS gesture behavior still needs a real device in the enabled block.

## Verification record

Local production-mode build and full typecheck passed. Focused ESLint reports no warnings. `bun test tests/inventory-query.test.ts tests/inventory-model.test.ts tests/slot-snapshot.test.ts` passes 38 tests; the affected six-profile Inventory matrix passes 30 tests. No full e2e suite or hosted writes were run. The build retains the repository's existing Cache Components/Partial Prefetching notice and generated docs CSS pseudo-element warnings.

This is a new standalone surface, so there is no previous production layout to measure. On 375×667 standalone, the worst-case text sheet measured 351 px wide at x=12, y=138.86, height=432.14; the close target is 44×44 px. Its bottom is 571 px, 8 px above the dock's 579 px top, with zero horizontal overflow. All six profiles assert viewport/safe-inset bounds, 36 px minimum controls and sheet/dock separation. Both color schemes were exercised; no real hardware was used.

| Before | After | Why |
| --- | --- | --- |
| No isolated Inventory view | One selectable row per physical copy, with explicit unknown/cached wording | Inspect duplicates without implying target ownership or complete cache coverage |
| Equivalent parent renders could change cursor object identity | Exact safe evidence key preserves the current window; actual scope/revision changes reset it | Host updates must not silently blank paginated rows |
| New repeated browse interactions | Instant query, keyboard and sheet entry; shared swipe primitive and direct press feedback | No decorative or keyboard-triggered motion was introduced |

UI and motion self-review: approve for the internal read-only slice. Current page/slot presentation, six dismissal paths, long grading strings and privacy projection are covered. Enabled production behavior, offline reload and native phone gestures remain the documented parent rollout gates.
