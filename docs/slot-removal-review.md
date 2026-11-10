# Deliberate slot removal (#369/#370), private preparation

The existing Edit layout controls now offer **Remove selected slot** in the selected stable-slot sheet and **Remove selected slots** for an explicitly chosen ordered group. Browse has no removal controls. Opening bulk editing never selects a page automatically. The existing select-page action remains explicit and excludes padding. Whole collection/default deletion is a separate operation and issue, never a requirement to manually empty a Dex binder.

Review freezes one `inventory` offline intent containing one existing `removeSlots` command. `prepareSlotRemoval` composes current root inventory, collection and layout revisions and exact slot/item/placement versions from the existing `BulkSelection` evidence. Selection order is the full saved order, independent of click order. Empty, missing, duplicate, changed or unsupported selections reject before handoff. The ordinary parser retains its 256 work-unit and 256 KiB request bounds: one work unit per slot plus one per assigned copy. There is no splitting or truncation. Larger retained evidence may still be refused atomically by the authoritative executor; a UI preview is not remote acceptance.

The preview lists every disappearing stable slot, target and explicit want, plus the exact owned copy becoming Unassigned. It projects through the existing canonical inventory projector without catalog guesses. Raw, graded, duplicate-printing and unknown-printing copies retain identity, grade/private assets, acquisition and source metadata. No `removeOwned`, reassignment or displacement is constructed. Remaining slots keep their saved relative order, current targets/wants and provenance. The original preset manifest remains independent of current goals; progress continues to count current targets.

## Host composition and acceptance

`LayoutBoundary.removal?: { available: boolean; receive: SlotCommandSink }` is an optional existing typed callback. BinderApp supplies the existing `browserSurface.bulkFill` binding, which already accepts inventory intents. No BrowserSession, queue, sender, lease, recovery protocol, schema or executor implementation changes are introduced. Synthetic draft-only picker hosts do not supply removal. The parallel restore-consumer lane owns extending this same binding with its pending-restore fence; this slice does not implement or independently certify that new lane. Parent integration must preserve that gate before exposing removal.

The existing sink requires a live owner/session and fresh complete reads, rejects pending commands (including creation) and unresolved recovery, and retains exact version predicates through durable acceptance. UI confirmation checks availability and unchanged captured selection. The existing queue owns local IDB acceptance, unknown-result retention, explicit exact retry, stale reconciliation and fresh complete replay ACK. A receipt from device commit says only Saved on device, pending sync. A server reply alone is not ACK. The frozen operation ID, timestamp, refs and consequence review survive a local IDB failure; retry sends the same intent. Closing a review cannot revoke an accepted request. Cached/offline evidence cannot start a removal.

The single review stays inside the existing shared slot-detail sheet. Bulk uses the shared overlay/swipe primitive with Cancel, X, backdrop, Escape, back, swipe and dock dismissal. A scope/view change exits the existing edit session.

## Activity and API boundary

No instant Undo, local guessed inverse, preview audit event or new history poller is added. After synchronization, the existing Activity entry point lets the user inspect supported recorded history, request **Review recovery**, inspect its authoritative current preview and explicitly confirm. Existing recovery checks current permissions/versions and records a linked recovery event. Unavailable history or changed dependencies may prevent recovery.

**Contract gap:** the existing `SlotLocalAcceptance` receipt and command ACK do not provide an exact Activity event ID or a supported recovery guarantee for the acknowledged removal. This slice therefore offers truthful Activity guidance, not a linked one-click Undo or a claim that any arbitrary history entry recovers this operation. Exact removal-to-event integration remains a parent-owned #369/#370/#396/#379 gate.

REST `POST /app/api/v1/storage/inventory/commands` and MCP `execute_inventory_commands` callers already compose the registered inventory command operation with `commands: [{ kind: "removeSlots", slots: [...] }]`, then the existing Activity and native recovery preview/apply operations. Use the existing omitted/`replace` mode for this explicit structural removal. `privateFields:"preserve"` deliberately rejects slot removal because the selected targets and wants are being removed. The command contains versioned references, not replacement grading/source metadata. The same ordinary limits, current owner permissions, original intent and replay semantics apply. Native mutation admission stays gated. The registry contract and generated OpenAPI are unchanged; this UI composition adds no operation or public schema. No hosted writes, SQL, conversion, admission, Framer publication or rollout is performed. Full #369/#370/#379 acceptance remains open.

## UI review

| Before | After | Why |
| --- | --- | --- |
| Edit layout offered insertion and whole-slot moves | Separate single/group removal review with exact consequence rows | Structural removal requires a deliberate confirmation |
| No removal recovery affordance | Truthful Activity guidance after sync | Existing receipts cannot identify an exact recoverable event |
| Single details already used a shared sheet | Single review remains within it; bulk reuses the shared overlay and swipe primitive | Preserves dismissal, dock and safe-area behavior |

No new animation or gesture implementation is added. Primary buttons remain at least 40px; long stable IDs and want text wrap inside the scrollable review. The six-profile test records before/review geometry and checks primary confirmation reachability, safe bounds and overflow.

## Local verification

Pinned Bun 1.3.14: 28 focused pure/HTTP/admission tests pass across seven files, including four new removal cases. Full typecheck, production build/docs CSS and full lint pass at the unchanged 55-warning cap. All new source/test files pass focused lint with zero warnings. The registered command schema accepts the prepared removal and continues rejecting structural removal in private-preserving mode; registry and generated OpenAPI are unchanged.

The corrected final removal spec passes all 78 Chromium cases without retries across 375×667, 390×844 and 430×932 browser/standalone safe-area profiles. The same production build also passed all 60 existing single-editor cases and six existing native recovery lost-reply/confirmed-apply/linkage cases. Removal tests use the actual component/host/IDB/HTTP and fresh reads, but synthetic session/catalog/RPC/history authority. They do not prove a SQL inverse or operation-to-event linkage for this removal.

At 375px the unchanged Browse toolbar is 359×58px; the review is 351×581px in-browser and 351×490px standalone, with its top at 12px and 77px respectively. At 390px review sizes are 366×758px / 366×667px; at 430px, 406×846px / 406×755px. Primary actions are hittable, at least 36px, with no horizontal overflow and the panel above the dock. Single confirmation reachability is also checked.

Initial verification corrected a missing test-host runtime flag and an assertion expecting disabled rather than absent unsupported recovery confirmation. A combined run passed 137/138 cases, with one cached-reload retry-button stability timeout caused by the existing sender completing replay while the control remounted. The corrected test permits that automatic exact replay, still asserting identical original bytes and fresh-read ACK; the full 78-case removal matrix then passes. No production sender behavior or assertion about request identity was relaxed. No full e2e, hosted mutation, physical-device/Safari or installed-PWA proof is claimed. Parent review and restore-consumer integration remain outstanding.
