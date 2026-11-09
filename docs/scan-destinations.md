# Staged scanner destination acceptance

Related: #375, #357, #366, #369, #382. This is an opt-in internal scanner boundary and deterministic harness, not enabled native storage. Runtime routes remain hard 503, executors denied and conversion closed. No hosted reads/writes, SQL, grants or public API are added.

## Wired flows

- `PageScanner` accepts `{ nativeAdmission, onClose }` without legacy species callbacks. Its native camera capture and page-photo input use `NativePageScanner`, freezing owner, collection, session, actual rows/columns, full saved order, current page's stable slot IDs and layout revision **before** camera encoding/detection awaits. The existing page detector supplies occupancy. Detector array order is ignored: validated index/row/column resolves to the captured ID. Uncreated trailing pockets remain unresolved.
- Native page review offers the device's cached catalog as **manual identity choices**, not automatic identified matches. It does not run the legacy expected-species matcher. Occupancy never supplies a card, grade, certificate, ACE artwork or ownership. An uncached/unidentified occupied cell requires Skip or Cancel.
- `QuickCardScanner` accepts optional `nativeAdmission`. It freezes the same capture when Read card starts, preserves the existing OCR, lookup and offline fallback, and hands the actual lookup candidates into the same review instead of calling the legacy deal-check callback. Type instead offers cached identities for explicit manual review. Ambiguous/non-dex lookup candidates remain choices, not automatic acceptance. OCR ranking/accuracy is unchanged.
- Without native admission, both components retain their original legacy implementations. The legacy CardSelector visual scanner, BinderApp photo handler, slot-sweep species writes and production Show/deal-check hosts are not converted by this slice. Parent host work must deliberately supply admission; no current app path enables it here.

## Host contract

`ScanDestinationAdmission` in `lib/scan-destinations.ts` carries the current complete, admitted `InventorySnapshot`, `ScanDestinationView`, cached catalog resolver and `onCommandIntent`. `NativePageScanAdmission` adds `getOfflineCards` and an optional occupancy-detector adapter (the default is the existing browser detector). The host supplies only the actual full page order, including free slots, never a filtered view or dex IDs. A noncontiguous page fails closed. Change `sessionId` on account, auth-session, owner, unlink/relink changes, including relinking to the same owner. Remount/close scanners on host navigation/dock switch.

Example of the private prop shape (synthetic placeholders, not a public API):

```tsx
<PageScanner nativeAdmission={{ snapshot, view: {
  ownerUserId, collectionId, sessionId, rows, cols,
  pageSlotIds: actualPageSlots.map(slot => slot.id),
}, catalog, getOfflineCards,
  onCommandIntent: (draft, scanCatalog) => activeQueue.enqueue(draft.intent, scanCatalog),
}} onClose={closeScanner} />
```

The second callback argument is the capture’s in-memory catalog resolver merged with the admitted host resolver. Pass it to the existing queue projector so a newly looked-up printing can satisfy a Pokémon target without another request. It is local preview evidence, never serialized command data or server authority. The host must retain the normal cached catalog/replay loading policy for later sessions; missing evidence stays pending rather than being guessed.

The host must fence this callback to its **current** account/session/owner and the admitted complete-snapshot queue, enforce its current read-only/entitlement policy, and resolve only after the real IDB commit with `{ status: "saved-on-device", operationId, refreshError }`. A void callback is insufficient. The scanner rechecks live capture scope/layout/grid/order immediately before first handoff and retry. Changed captures require cancellation and recapture, never positional reassignment. Slot/item/version predicates and the queue projection reject intervening content conflicts.

All occupied cells must be explicitly resolved or skipped before confirmation. Skipped cells make no command. Every included cell requires identity, copy policy and a destination; repeated species never preselect the first row. The target/free candidates use shared `matchesSlotTarget` via `pickerCandidate`, and final intent is parsed and projected with the existing inventory boundary. Exact language/finish targets reject missing or mismatched evidence. Finish choices come from catalog helpers or remain unknown, never from OCR. Explicit recorded copy IDs preserve their metadata. Raw selection reuses an eligible Raw Unassigned copy; otherwise existing `add` plus `assign` with that exact new item ID creates/places Raw in the **same inventory request**, with grading/acquisition unknown. Assigned copies stay put. Multiple confirmed cells form one bounded request, with duplicate slot/cell/copy guards. Wants are unchanged (`fulfillWant: null`).

The prepared batch is immutable after first handoff. Failed local persistence retains the exact operation/item IDs for retry; no success is shown before a matching durable receipt. Cancel before handoff creates nothing; cancel during page detection discards late work. Once confirmation starts a local commit it cannot be canceled mid-transaction. Device acceptance is pending sync, never remote execution, acquisition/audit success or a fresh-owner ACK. Reuse #363's authority; no shadow queue or automatic replay is installed.

## Explicit remaining operation gap

Existing private `SlotOfflineIntent` is either a slot command request or an inventory command request. `InventoryCommand` cannot create a new slot, and `SlotCommand` cannot assign inventory. Consequently **append free slot plus assignment cannot currently be one atomic confirmed scan batch**. The destination select exposes append as unavailable with this reason. This slice does not enqueue a separate structural write, fabricate a new destination ID, save half a page or introduce another transaction format. #362/#383/#369 must provide a shared atomic create-slot-and-assign intent before enabling append from scans. Exact Raw add-and-assign is already represented; it is not this blocker. SQL execution of that path remains unverified here.

## API, help and proof boundaries

Capture/OCR and transient review are browser/device capabilities, not remote operations. This slice changes no supported REST/MCP registry, permissions, OpenAPI schemas, generated exports or server mutation/audit history. #376 owns supported native parity, #379 admission/conversion/exposure, #394/#396 authoritative audit/recovery, #393 publication. Read-only staged help lives at `/app/docs/scan-destinations`; release copy remains unpublished.

`tests/scan-destinations.test.ts` covers pure ID mapping, stale order/revision/grid/page/session/scope, target rejection, non-Pokémon, repeats, atomic Raw creation and preserved grades. `e2e/scan-destinations.e2e.ts` drives the real PageScanner and QuickCardScanner entry points with synthetic occupancy/OCR/catalog and real IDB queue: six phone browser/standalone projects, shuffled cells, unresolved occupancy, durable batch/reload, explicit repeats, exact retry, stale review, offline cached lookup, cancel/late detection and sheet dismissal/geometry. The page detector is substituted in the harness; no page accuracy/hardware proof is claimed. OCR uses a synthetic TextDetector. Offline component proof does not prove cold chunk/SW precaching or a production installed PWA. No full e2e suite, hosted/partner data or enabled product proof is claimed.

Capture and review retain a single shared overlay/history entry. Camera completion cannot pop the review's history entry; browser/Android Back dismisses the whole unconfirmed session on the same route. Review uses the same focus container and existing swipe primitive, with dismissal blocked only during confirmed durable acceptance.

## Scoped verification record

- 43 focused unit/doc checks pass across scanner destinations, identification, page aggregation, picker, optimistic commands and docs routing/OpenAPI.
- Full typecheck and production build pass with dummy local Supabase values. Full lint passes with the same 55 existing warnings; new/modified scanner logic has no added warnings.
- 132 focused browser cases pass: 102 native scan cases, six legacy page-scanner cases and 24 legacy Show cases, across browser and emulated standalone at 375×667, 390×844 and 430×932. Command: `E2E_PORT=3287 bun run test:e2e:matrix e2e/scan-destinations.e2e.ts e2e/page-scanner.e2e.ts e2e/show-scan.e2e.ts --grep-invert 'reads the name and number|offline, it still reads' --workers=2` (dummy local Supabase credentials and `HOLOFOLDER_E2E=1`).
- The two excluded Show cases expect a `Wanted` badge but receive `Not in binder`. Both failures reproduce at 375 in a build using the **unmodified `8371a8f` QuickCardScanner** with the synthetic native harness's unused admission prop temporarily omitted for type compatibility. OCR still returns the expected printing. This records an inherited host/fixture limitation, not green proof for those two tests. No collection/pricing/host change was made to silence them.
- Review sheets stay in the safe viewport with reachable 36px+ actions. Measured browser/standalone bounds respectively: 375, `(8,24,359,581)` / `(8,89,359,490)`; 390, `(8,24,374,758)` / `(8,89,374,667)`; 430, `(8,38,414,832)` / `(8,89,414,755)` in `(x,y,width,height)` pixels. This is a new staged sheet, so no legacy sheet geometry was changed. No horizontal overflow in the assertions.

No independent review, hardware scan, cold-SW offline, hosted SQL/data, production host integration, runtime execution or deployment/publication proof is supplied. These remain parent-owned release gates.
