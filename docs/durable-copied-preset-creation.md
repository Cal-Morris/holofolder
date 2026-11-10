# Durable copied-preset Binder creation, staged

Related: #368/#384, #367/#363/#379. This consumer slice does not enable production creation, perform conversion, or establish first/native owner authority. Parent owns independent review, backup, migration application, merge, deployment and final acceptance. No SQL changes belong to this slice.

## Actual host and boundary

The admitted native BinderApp navigation header has an explicit **New binder** action. It opens the shared overlay, copies the existing preset builder's ordered preview into an immutable review draft, then requires **Confirm create binder**. Supported starts are Blank (zero stored slots), National Dex (1,025), generation, ordered selected species and actual selected catalog printings. Language needs real catalog evidence; unspecified finish stays unconstrained. There is no catalog subscription, inventory acquisition, grade or explicit want. Repeated printing targets receive separate stable slot IDs. Visual page padding is not stored.

Set/master-set remains unavailable in this native flow. `CollectionCreationCommand` retains the manifest but not the separate `SetChecklist` scope. The adapter explicitly refuses a checklist instead of silently dropping scope. Presets remain independent of storage kind; this UI exposes Binder only. Slabs/general storage exposure remains separately owned by #390/#384.

The legacy-authoritative switcher keeps its existing creation path. The native path never calls `/api/binders`. It sends the existing `collection.create` command through the trusted bridge. `/app/api/storage-collections` is unconditionally private/no-store 503; only the existing loopback/nonhosted harness invokes the real handler with synthetic RPC/auth dependencies. There is no flag or request bypass for production admission.

## Planning and durable acceptance

Creation requires a currently authorized, branded complete native inventory read with existing native collection/binder authority. Cached startup and empty/unavailable/fabricated owner snapshots cannot create. No legacy default binder or empty owner revision is synthesized to bypass #379 bootstrap. The UI keeps existing name normalization, owner collection allowance and safety cap; the server retains authoritative name, count/order, catalog, role, billing and grid enforcement. `grid:null` inherits current owner layout through the existing command, without inventing custom-grid entitlement.

The operation, collection, slot IDs, copied manifest and original client time/context are allocated once before the first durable handoff. A failed IDB transaction retries that same intent. The existing `SlotOfflineIntent` union now includes `creation`; no parallel store, localStorage request shadow or ledger is added. It is retained in the existing atomic snapshot/pending/receipt record under device/account/owner scope. Creation leaves the optimistic snapshot unchanged. Creation and unresolved recovery fence other host sinks; an explicitly discarded recovery is resolved by the existing `recoveryUnresolved` predicate.

The session checks current actor/owner/auth session before and within handoff, sending and read acceptance. Existing leases fence competing retries and teardown. Reload/lost replies replay the same body and operation ID. “Saved on this device” means **creation pending sync**, not remote creation. No half-created collection becomes usable.

A matching private receipt must identify the exact collection and ordered slot IDs. It is historical acceptance only. The queue starts a separate branded all-stream read after the matching reply, checks freshness and revision, commits its ACK, then the host can navigate only if the collection is still present and no later user navigation owns the screen. Reload cancels auto-navigation ownership. A later legitimate deletion is never reconstructed from a historical receipt.

## Remaining 093 consumer gate

This checkout does not contain the separately reviewed creation/import terminal rejection proof contract. Backend [PR #478](https://github.com/Cal-Morris/holofolder/pull/478), head `b9fc24580de94e77f6da939bcf968b0128262856`, was observed open with no submitted reviews during implementation. It is not this PR base. Every creation failure, including HTTP 400/402/403/409, remains an unresolved exact intent. Status codes do not prove noncommit; there is no cancellation, rebase, replacement, proof fabrication or parallel guard/ledger. Billing/auth failures pause with the original intent retained and explicit retry. Unknown outcomes retain bounded retry/backoff.

After parent reviews the 093 source, integrate its **shared** strict creation rejection guard and authoritative serialization, persist matching terminal proof in this same atomic record, obtain a post-proof fresh complete scoped read, and permit only explicit discard under that proof and current-session/lease fences. Do not treat this slice as that integration or as enablement evidence. Existing slot/inventory terminal proof and Activity Undo remain separate and unchanged.

## API/help and release

The device picker/IDB lifecycle is app-specific. Existing staged `list_storage_presets` and `preview_storage_preset` compose with existing staged `create_storage_collection` (REST `POST /app/api/v1/storage/collections`, MCP of the same name). Preview entry IDs are provenance, not operation/collection/slot identity. Developer clients retain their own exact command and must obtain authorized current planning evidence; preview/public read projections are not that evidence. This slice changes no registry schema or OpenAPI output. All fixed native admission remains denied.

Current help: `content/docs/native-storage.mdx` and `content/docs/preset-previews.mdx`; capability coverage: `docs/public-api/coverage.md`. Unpublished release preparation: `docs/releases/durable-copied-preset-creation-draft.md`. No announcement or Framer publication is authorized here. #368/#384 and related full acceptance remain open.

Local browser proof uses real BinderApp/overlay/IDB/HTTP/fresh reads with clearly synthetic RPC and authentication, not hosted SQL, RLS, device hardware, rollout or production proof. Run only affected six-phone browser/standalone specs on a private port, never the full e2e suite for this slice.

## Craft review

| Before | After | Why |
| --- | --- | --- |
| Native navigation had no creation entry | Explicit New binder with a bounded preview/confirmation sheet | Make creation deliberate and reviewable |
| No native creation sheet | Dynamic viewport cap, dock clearance, shared overlay and swipe header | Keep controls reachable on short standalone phones |
| Cached startup could expose an edit affordance whose sink refused writes | Explicit read-only editing availability | Match the affordance to current planning authority |

No new animation is added. Keyboard review/confirmation is immediate; dismissal uses the existing shared gesture. Browser tests cover safe areas, focus return, X/Escape/back/backdrop/swipe/dock navigation, exact counts, long existing catalog labels, current allowances and missing catalog evidence. Physical-device keyboard/gesture behavior is not claimed.

Measured blank-sheet layout: before this slice native navigation had no creation entry. The new entry is 42 px high. At 375/390 widths the sheet is 491 px high; at 430 it is 475 px high. In every browser/standalone profile the sheet bottom equals the dock top, with no overlap. The 375 standalone sheet spans y=88..579 in a 667 px viewport with 59/34 px safe-area insets; its dock begins at y=579. All six profiles pass safe-viewport, tap-target, keyboard and overflow assertions.

## Submitted local verification

Pinned Bun 1.3.14: 118 focused unit/contract cases across 13 files pass. 210 distinct affected phone cases pass across all six browser/standalone profiles: 168 creation/command cases, six two-Binder copy-isolation cases, and 36 scanner/bulk-fill/private-grading/recovery callback regressions. Eighteen creation/pending/IDB-abort cases were rechecked after final user-facing message polish, with no retries or flakes. Typecheck and production build/docs CSS pass. Full lint passes at the unchanged 55-warning cap; focused changed-module lint has zero warnings. No full e2e, SQL, hosted, physical-device or deployed enablement proof is claimed.

The existing offline command regression now waits for durable pending state instead of sampling IndexedDB immediately after its asynchronous handoff. Existing parser/editor tests retain their contract with discriminant narrowing for the new creation union member. Legacy queues and Activity Undo were not changed.
