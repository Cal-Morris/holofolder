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

## 093 consumer integration

This follow-on consumes the reviewed 093 shared creation rejection and authoritative serialization as described below. Generic errors remain unresolved exact intent, with bounded retry/backoff and no discard/rebase authority. Slot/inventory reconciliation and native recovery remain separate and unchanged. Local consumer evidence does not establish hosted execution or production admission.

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

## Creation terminal-proof consumer, staged

The first-party handler recognizes `isCreationRejection` from 093 and uses the same `StorageCreationRejectedError` / `developerErrorResponse` as REST/MCP. Accepted envelopes are unchanged. Rejection delivery adds `X-Storage-Delivery` (per-send nonce), `X-Storage-Family: collection.create`, `X-Storage-Operation` and the serializer's request ID. The browser requires the private/no-store JSON error envelope, matching headers and an uninterrupted original read scope. The authenticated bridge also checks the browser's expected actor, current JWT session and owner before replay/execution. No error text or parallel rejection-code classifier is used.

New creation pending entries retain original `creationAuthSessionId` without changing the immutable SlotOfflineIntent, request IDs, timestamp/context, scope key or legacy/accepted receipts. Bound proof includes that intent, family, delivery, original account/owner/auth session and the strict shared rejection. It is retained in `pending[].conflict.creationProof` in the SAME SlotOfflineRecord transaction. A separate fresh complete current read follows proof retention. Failure/abort/reload preserves original proof and intent. Old pending creation without original auth-session evidence cannot acquire discard authority. A different account/owner/JWT session cannot discard the original operation.

**Discard rejected creation** is an explicit device decision, never acceptance or synchronization. It claims the existing head lease, starts another authoritative complete read after proof, and atomically compares scope, exact intent/proof/auth session, unexpired lease, pending/recovery guards and nondecreasing current/proof revisions. It moves the exact intent/proof into optional `creationDiscards` with `resolution:"discarded"` in that same record. Accepted `receipts` remain byte-compatible and separate. Failed reads, CAS, IDB transactions or session changes retain intent/proof. A later new creation cannot reuse the rejected operation, collection or slot IDs and must pass the existing preview/confirmation flow. No auto-rebase of creation, known or unknown, exists.

Device-only reconciliation adds no public mutation. Existing REST/MCP creation schemas and authoritative errors remain current; generated OpenAPI is unchanged. Production first-party/developer admission stays fixed 503. No SQL, hosted changes, bootstrap/read-only startup, backup/import domain, source auth/billing, legacy Activity/Undo, scanner/grading/bulk behavior or Framer publication changes.

| Before | After | Why |
| --- | --- | --- |
| All creation errors retained with retry only | Bound 093 proof offers one explicit discard button | Separate proven noncommit from unknown outcomes |
| Reconciliation used command cancellation/rebase language | Creation says discard and requires New binder review | Never imply synchronization or silently rewrite creation |

No motion added or changed. The existing native sheet/dock gestures remain unchanged. The inline button uses the existing 36 px minimum target and wrapping explanatory text; affected six-phone checks verify safe bounds and overflow. Synthetic Auth/RPC, real handler/browser/IDB/read pipeline evidence remains distinct from hosted SQL and installed-device proof. Parent owns independent review, checks, merge, deployment and issue acceptance; all full issues remain open.

### Follow-on local verification

On main `d88380105c75dd1a05e4a4fc4ecd49c1557deaa7` including #479, pinned Bun 1.3.14 passes 120 focused unit/contract cases across 11 files, typecheck, production build/docs CSS and lint with the unchanged 55 warnings. Changed-code lint has zero warnings. The combined 216-case affected six-phone run passes every one of the 174 creation cases, plus command/recovery/scanner/bulk/private-grading and guard regressions, with two inherited test failures: backup's whole-record equality sampled the valid pending-to-unavailable sender transition, and 375 standalone cached startup timed out. Isolated backup/startup rerun passes 11/12; all six backup guards pass, with the same startup timeout. An independently built unmodified main `d883801` also reproduces that startup timeout. No backup/import or startup implementation/test edits are included; that baseline test gate remains with the parent. Earlier pre-#479 creation and terminal-proof matrices passed 156 and 90 cases respectively. No full e2e, hosted SQL, physical-device, enabled-production or publication claim.
