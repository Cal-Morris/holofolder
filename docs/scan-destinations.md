# Staged scanner destination acceptance

Related: #375, #357, #366, #369, #382. This includes the actual BinderApp/BrowserCollectionSession host binding behind the existing non-hosted loopback harness, not enabled production native storage. Runtime routes remain hard 503 and conversion closed. Prototype SQL executors remain runtime-denied; the service-only gateway retains its existing authority and admission checks. No hosted reads/writes, SQL, grants or public API are added.

## Wired flows

- `PageScanner` accepts `{ nativeAdmission, onClose }` without legacy species callbacks. Its native camera capture and page-photo input use `NativePageScanner`, freezing owner, collection, session, actual rows/columns, full saved order, current page's stable slot IDs and layout revision **before** camera encoding/detection awaits. The existing page detector supplies occupancy. Detector array order is ignored: validated index/row/column resolves to the captured ID. Uncreated trailing pockets remain unresolved.
- Native page review offers the device's cached catalog as **manual identity choices**, not automatic identified matches. It does not run the legacy expected-species matcher. Occupancy never supplies a card, grade, certificate, ACE artwork or ownership. An uncached/unidentified occupied cell requires Skip or Cancel.
- `QuickCardScanner` accepts optional `nativeAdmission`. It freezes the same capture when Read card starts, preserves the existing OCR, lookup and offline fallback, and hands the actual lookup candidates into the same review instead of calling the legacy deal-check callback. Type instead offers cached identities for explicit manual review. Ambiguous/non-dex lookup candidates remain choices, not automatic acceptance. OCR ranking/accuracy is unchanged.
- Without native admission, both components retain their original legacy implementations. The legacy CardSelector visual scanner, species photo handler, slot-sweep writes and production Show/deal-check hosts keep their existing behavior. Native Scan page owns its photo input and never enters those legacy callbacks. The admitted native BinderApp supplies the scanner admission described below; legacy production paths do not.

## Actual BinderApp session binding

`BrowserCollectionSession` supplies its admitted complete snapshot, exact session ID, matching saved grid, catalog/cache lookup and a scan-specific durable sink. `BinderApp` renders Scan page and Scan card in the unfiltered native Binder view outside Edit layout, using the current page slice of full saved slot IDs. Page or view changes remount the transient scanner; account/owner/partner/auth changes tear down the scoped session. The queue outlives all those transient components. No current viewer becomes a new owner. Original photo/evidence persistence remains #389/#390. Activity/recovery #396 and analytics/dashboard #374 are unchanged.

The sink checks the still-live scope, complete online planning base and absence of unresolved pending edits before enqueue. The scanner checks captured grid/order/revision immediately before handoff and retries; queue version predicates remain authoritative. A matching persisted receipt closes review. The existing session sender replays the unchanged request ID/body and only removes it after a matching command reply followed by a fresh complete scoped read. A lost reply or session teardown retains the original intent in IndexedDB. Scanner closure never cancels a committed intent.

Cached-only native startup remains read-only. Reconnect, refresh checked complete storage, and finish syncing pending edits before starting another scan. If connectivity is lost during review, cached identity choices remain available, but acceptance is refused until the online complete planning boundary is restored. The scanner does not introduce offline authority, a second queue, photo uploads, personal image caching or new service-worker HTML caching.

Native card capture now uses the same safe-area/dock-bounded sheet and shared backdrop/swipe dismissal as page review. Legacy full-screen camera layout is preserved. Manual recorded-copy choices list stable copy IDs individually, including same-grade duplicates.

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

All occupied cells must be explicitly resolved or skipped before confirmation. Skipped cells make no command. Every included cell requires identity, copy policy and a destination; repeated species never preselect the first row. The target/free candidates use shared `matchesSlotTarget` via `pickerCandidate`, and final intent is parsed and projected with the existing inventory boundary. Exact language/finish targets reject missing or mismatched evidence. Finish choices come from catalog helpers or remain unknown, never from OCR. Explicit recorded copy IDs preserve their metadata. Raw selection reuses an eligible Raw Unassigned copy; graded-only eligible copies require an explicit recorded choice, because Raw creation beside them is unsupported. With no eligible copies, existing `add` plus `assign` with that exact new item ID creates/places Raw in the **same inventory request**, with grading/acquisition unknown. Assigned copies stay put. Multiple confirmed cells form one bounded request, with duplicate slot/cell/copy guards. Wants are unchanged (`fulfillWant: null`).

The prepared batch is immutable after first handoff. Failed local persistence retains the exact operation/item IDs for retry; no success is shown before a matching durable receipt. Cancel before handoff creates nothing; cancel during page detection discards late work. Once confirmation starts a local commit it cannot be canceled mid-transaction. Device acceptance is pending sync, never remote execution, acquisition/audit success or a fresh-owner ACK. Reuse #363's authority; no shadow queue or automatic replay is installed.

## Explicit remaining operation gap

Migration 091 adds `InventoryCommand.insertAssign` inside the existing authoritative inventory transaction, with stable new slot ID, exact existing before-anchor or explicit append, target/free intent and explicit Unassigned/new-copy selection. The canonical strict parser, durable projector and staged REST/MCP registry now represent this atomic intent. See [contract and local proof](atomic-insert-assign.md).

**Scanner append remains unavailable in this slice.** `prepareScanDraft` and the destination review still emit existing-slot assignments; they must consume `insertAssign` through the original confirmed batch and existing #470 host queue. Keep capture scope/layout/order checks, explicit copy review, IDs frozen after first handoff, durable acceptance and fresh complete-read ACK. Do not change the disabled option to claim a save, split insertion from assignment, use a fake existing-slot reference, or broaden Raw creation beside graded-only eligible copies. This precise consumer gap remains #375/#362/#383/#369 work, separate from hosted 091 application and #379 admission.

## API, help and proof boundaries

Capture/OCR and transient review are browser/device capabilities, not remote operations. This slice changes no supported REST/MCP registry, permissions, OpenAPI schemas, generated exports or server mutation/audit history. #376 owns supported native parity, #379 admission/conversion/exposure, #394/#396 authoritative audit/recovery, #393 publication. Read-only staged help lives at `/app/docs/scan-destinations`; release copy remains unpublished.

`tests/scan-destinations.test.ts` covers pure ID mapping, stale order/revision/grid/page/session/scope, target rejection, non-Pokémon, repeats, atomic Raw creation and preserved grades. `e2e/scan-destinations.e2e.ts` drives the real PageScanner and QuickCardScanner entry points with synthetic occupancy/OCR/catalog and real IDB queue: six phone browser/standalone projects, shuffled cells, unresolved occupancy, durable batch/reload, explicit repeats, exact retry, stale review, offline cached lookup, cancel/late detection and sheet dismissal/geometry. The page detector is substituted in the harness; no page accuracy/hardware proof is claimed. OCR uses a synthetic TextDetector. Offline component proof does not prove cold chunk/SW precaching or a production installed PWA. No full e2e suite, hosted/partner data or enabled product proof is claimed.

Capture and review retain a single shared overlay/history entry. Camera completion cannot pop the review's history entry; browser/Android Back dismisses the whole unconfirmed session on the same route. Review uses the same focus container and existing swipe primitive, with dismissal blocked only during confirmed durable acceptance.

## Prior #451 verification record

- 43 focused unit/doc checks pass across scanner destinations, identification, page aggregation, picker, optimistic commands and docs routing/OpenAPI.
- Full typecheck and production build pass with dummy local Supabase values. Full lint passes with the same 55 existing warnings; new/modified scanner logic has no added warnings.
- 132 focused browser cases pass: 102 native scan cases, six legacy page-scanner cases and 24 legacy Show cases, across browser and emulated standalone at 375×667, 390×844 and 430×932. Command: `E2E_PORT=3287 bun run test:e2e:matrix e2e/scan-destinations.e2e.ts e2e/page-scanner.e2e.ts e2e/show-scan.e2e.ts --grep-invert 'reads the name and number|offline, it still reads' --workers=2` (dummy local Supabase credentials and `HOLOFOLDER_E2E=1`).
- The two excluded Show cases expect a `Wanted` badge but receive `Not in binder`. Both failures reproduce at 375 in a build using the **unmodified `8371a8f` QuickCardScanner** with the synthetic native harness's unused admission prop temporarily omitted for type compatibility. OCR still returns the expected printing. This records an inherited host/fixture limitation, not green proof for those two tests. No collection/pricing/host change was made to silence them.
- Review sheets stay in the safe viewport with reachable 36px+ actions. Measured browser/standalone bounds respectively: 375, `(8,24,359,581)` / `(8,89,359,490)`; 390, `(8,24,374,758)` / `(8,89,374,667)`; 430, `(8,38,414,832)` / `(8,89,414,755)` in `(x,y,width,height)` pixels. This is a new staged sheet, so no legacy sheet geometry was changed. No horizontal overflow in the assertions.

No independent review, hardware scan, cold-SW offline, hosted SQL/data, enabled production integration, authoritative SQL execution or deployment/publication proof is supplied. These remain parent-owned release gates.

The synthetic scanner harness uses the established Inventory harness gate: hosted Vercel builds are denied even with HOLOFOLDER_E2E=1, and request hostnames must be loopback. Environment enablement alone cannot admit it.
The request-time hostname denial uses Next notFound within the shared static shell: a streamed response can carry HTTP 200, but contains the 404 boundary/noindex and no scanner harness content.

## Actual host verification, #375 follow-up

Base: main `16fa30375d3c64716a97254cc9426d933146a13b`. Direct toolchain: `/Users/cal/.local/share/holofolder/toolchains/bun-1.3.14/bun-darwin-aarch64/bun` (1.3.14). Dummy loopback Supabase values, `HOLOFOLDER_E2E=1`, own port 3296; no hosted database access.

- 91 focused tests pass across 13 scanner/planner/queue/transport/catalog/admission/doc suites. The new graded-only Raw regression failed before the planner guard and passes afterward.
- Full typecheck, lint and production build pass. Lint retains the same 55 warnings; no new warning and no cap change. No schema/registry/generated API change.
- Initial six-phone matrix: **210 passed** (`native-scanner-host`, `scan-destinations`, `page-scanner`). Final host/transport/legacy matrix: **204 passed** (`native-scanner-host`, `browser-command`, `show-scan`). These overlap; together they cover **318 distinct cases** across five focused specs, not 414 unique cases. A separate six-profile real IDB abort/retry run also passed and is included again in the final matrix.
- The final actual-host spec has 19 cases per profile: explicit Energy/free destination and fresh ACK, lost reply/reload, repeated target selection/cancel, cached-only rejection, account/signout/partner teardown, inserted free pocket and atomic page confirmation, layout/grid changes during capture, unknown/ambiguous results, all shared dismissals, real aborted IDB transaction/exact retry, distinct duplicate-copy item IDs through a lost reply, and empty-page append explanation. The existing command spec also proves in-flight teardown/lease retention and stale-read refusal.
- The first host run had three test failures: an unscoped Done selector matched two controls, and both stale-layout/grid tests dispatched focus, which intentionally invalidates auth scope and tears down the session. The selector now targets the dialog; same-session layout tests use the existing visibility-refresh path. The focused rerun passed before the matrices above. No guard was relaxed.
- The two legacy Show tests named `reads the name and number...` and `offline, it still reads...` are excluded using #451's documented Wanted-badge baseline. They were not re-proved on this head; 24 other Show cases pass. This is an explicit proof limit, not a green claim for those two tests.

Commands (use the direct Bun path above in place of `bun`):

```sh
E2E_BASE_URL=http://localhost:3296 bun run test:e2e:matrix e2e/native-scanner-host.e2e.ts e2e/scan-destinations.e2e.ts e2e/page-scanner.e2e.ts --workers=2
E2E_BASE_URL=http://localhost:3296 bun run test:e2e:matrix e2e/native-scanner-host.e2e.ts e2e/browser-command.e2e.ts e2e/show-scan.e2e.ts --grep-invert 'reads the name and number|offline, it still reads' --workers=2
```

These drive the actual BinderApp and BrowserCollectionSession with real IDB and the existing loopback HTTP handlers/trusted bridge/fresh complete read. Synthetic camera/OCR/page-cell/catalog/PostgREST/ledger data are clearly labelled in fixtures. The page detector seam requires existing local-harness admission plus explicit `scanFixture=1`; production capture uses the unchanged on-device detector. It cannot admit hosted or non-loopback storage routes. Original photos are not sent through card-image-proxy or uploaded elsewhere.

Native capture previously reused a fullscreen camera dialog `(0,0,viewport width,viewport height)`. The new host's native card capture uses the safe sheet bounds below; legacy callers retain their fullscreen layout. Page capture/review retain the existing shared sheet styling. All six profiles pass safe viewport, no horizontal overflow, reachable 36px+ close/actions, X/Escape/Back/backdrop/swipe/dock dismissal and scroll-unlock checks. Bounds are `(x,y,width,height)` in px, measured before dismissal:

| Profile | Page capture | Card capture | Review |
|---|---|---|---|
| browser-375x667 | (8,107,359,498) | (8,24,359,581) | (8,223,359,382) |
| standalone-375x667 | (8,89,359,490) | (8,89,359,490) | (8,197,359,382) |
| browser-390x844 | (8,284,374,498) | (8,24,374,758) | (8,400,374,382) |
| standalone-390x844 | (8,258,374,498) | (8,89,374,667) | (8,374,374,382) |
| browser-430x932 | (8,372,414,498) | (8,24,414,846) | (8,508,414,362) |
| standalone-430x932 | (8,346,414,498) | (8,89,414,755) | (8,482,414,362) |

No full e2e, camera hardware, real recognition/provider, cold service worker/PWA, authoritative SQL execution, hosted data, enabled production, independent review, merge/deployment or publication proof. #375 stays open; parent reviews and ships.

## Parent combined-main verification

After GitHub reported the branch seven commits behind main, the parent merged current main and retained native analytics, terminal response contracts and preset documentation. Independent source review at `393422bc1251bfdcd6aae99aae07aa7d275d3915` found no blocker and passed 86 focused cases. The combined candidate passed 1,540 unit tests with 37 explicit SQL-gated skips, full typecheck, production build/docs CSS and lint with 55 existing warnings. `E2E_PORT=3586 bunx playwright test e2e/native-scanner-host.e2e.ts e2e/native-analytics.e2e.ts --project='*'` passed all 126 cases across the six phone profiles. This rechecks scanner/analytics coexistence and real IndexedDB acceptance with synthetic transport/catalog/capture evidence. It does not add hardware, hosted SQL, cold service-worker or enabled-product proof. The known legacy Show exclusions above remain unverified. #375 and #379 remain open.
