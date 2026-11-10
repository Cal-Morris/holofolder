# Inventory ownership actions, staged

Related: #383/#385. This is current native app preparation, not enabled production behavior. Production native admission and first-party inventory writes stay fixed private/no-store 503. No schema, grants, conversion, queue protocol or executor change is included.

## Device flow

The authenticated `BrowserCollectionSession` supplies a complete owner-wide private snapshot and its existing durable command sink to Inventory. New actions require a current online complete read, current account/session/owner, no pending command (including creation), no legacy intent and no unresolved recovery. Cached/unavailable Inventory stays read-only. Confirmation refreshes current complete scoped storage before enqueue, retaining the original reviewed request rather than replanning it. The sink rechecks the active scope, inventory revision, IDB record and pending/recovery gates immediately before enqueue; existing queue admission, send leases and server current owner/partner/billing checks remain authoritative.

- **Add owned card** reuses the slot catalog search UI and catalog/finish rules. It previews a distinct Raw copy as Unassigned and uses existing `add`, with explicit new item and operation IDs, null grading/acquisition date, and no collection preconditions. Existing copies of the selected printing can be inspected; **Add another raw copy** never modifies/reuses a raw or graded duplicate. Catalog language is a search filter; missing selected identity metadata stays missing.
- **Assign copy / Move copy** operates on the selected physical item ID/version and exact placement, using existing `assign` with `selection.kind=existing` or `move`. The user deliberately chooses a compatible stable slot across current authorized storage. Unknown catalog evidence permits free slots only. Unknown language/finish cannot satisfy constrained targets. The source/destination collection, layout, slot, item and placement versions are captured. Occupied slots require an explicit decision with no default: move the occupied copy to Unassigned, or swap when the selected copy has a source and both resulting targets match. Cancel never dispatches. Choices are probed through the existing atomic projector, not a new planner or executor. No wanted entry is implicitly fulfilled (`fulfillWant:null`).
- **Unassign copy** retains the item, identity, acquisition/source metadata and ownership count. Its source slot becomes unfilled, keeping target, wants, provenance and order.
- **Remove owned copy** previews the exact copy ID, source storage/stable slot or Unassigned, ownership decrement, cleared placement and retained slot goals/order. Other copies are unchanged. Only confirmed existing `removeOwned` deletes ownership.

Previews use `parseSlotIntent` and `projectSlotIntent`. Confirmation retains the exact immutable request through local failure and retries. Local acceptance means committed IndexedDB only. Existing sender/HTTP bridge, trusted audit context and a separate fresh complete all-stream read govern remote ACK. An unknown response retains the original intent and operation/item IDs, with no fabricated acquisition, receipt, history or Undo.

## Occupied destinations

The destination reference includes the exact occupied copy and its item/placement/slot versions. The source reference and both collection/layout versions remain mandatory. Review names both physical IDs, recorded printing/language/finish/Raw or provider-grade, exact before/after collection and stable slot, retained targets and explicit wants. Displacement retains the occupied copy as Unassigned; swap puts it in the selected copy's former slot. Neither path creates/removes ownership, changes private grading/certificate/acquisition/source metadata, removes targets, changes order/provenance or fulfills wants (`fulfillWant:null`). Unknown printing remains unknown and can enter only a free slot unless catalog evidence proves the target match.

A graded destination copy is supported only through these existing exact-ref commands and the accepting projector, with no metadata reconstruction or grade edit. Selected graded copies use the same individual assign/move/unassign review, including compatible occupied decisions. Every item field is retained, including custom providers, grade/scale/designation/subgrades, certificate, holder, label variant/private asset IDs, acquisition and immutable source. Commands send exact references, never replacement grading. Swap is absent for Unassigned sources or incompatible reverse targets; incomplete references and unsupported projector decisions fail closed. A new pending deletion, raw restore, creation, recovery or ordinary command fences this same sink/queue. Account/session/owner/membership and revision changes invalidate review before dispatch or conflict at the authoritative server; retries keep original intent rather than rebasing.

After a strict reply and separately fresh complete ACK, expand **Review synchronized changes** and use the shared **Find acknowledged change** control. This compact disclosure keeps the short standalone viewport usable after ACK. It looks up the exact operation, then the exact Activity event. Missing, ambiguous, stale or unsupported history never invents an event or inverse. Recovery is offered only by the existing engine preview and current permission/version checks, with no guaranteed Undo.

## Recovery and deliberate limits

After synchronized removal, the existing Activity entry owns recovery preview and confirmation. The existing private event payload preserves the original item ID, metadata and placement; current permission, version, dependency, billing and plan-token checks still apply. A newer placement must never be displaced: Activity can explicitly restore the removed item as Unassigned. Unsupported/incomplete history is reported by that existing recovery boundary. This slice adds no local inverse, new restore operation, or instant Undo promise.

Graded removal remains blocked, including asset-free graded copies in this bounded UI slice: migration 077 rejects inventory-item inverses with private label assets as `private_assets_unverifiable`. Placement changes do not delete or rewrite inventory items, so no private-asset recovery extension is needed. Graded creation, graded bulk actions, occupied bulk destinations and new arbitrary unknown-printing creation remain outside this slice. Unknown existing printing identities can be retained/moved/unassigned/removed without replacing them with guessed catalog cards. Complete current scope, hosted admission, conversion/old-client and independent production proof remain parent rollout gates. Creation proof from #481 must be retained when integrating this additive BrowserSession binding.

## API composition

No API/schema operation is invented. Existing staged REST `POST /app/api/v1/storage/inventory/commands` and MCP `execute_inventory_commands` express `add`, explicit `assign`/`move` (including existing `occupied:"unassign"` and move-only `occupied:"swap"`), `unassign` and `removeOwned`. Developer clients use `privateFields:"preserve"`, exact public references and `fulfillWant:null` so they do not reconstruct private metadata from browse DTOs. Existing staged recovery preview/apply operations own restoration, with current scopes and confirmation. First-party commands use `/app/api/inventory`, the existing trusted adapter and private complete-read boundary. All native production paths remain denied as before. No registry change means generated OpenAPI is unchanged. The device-specific selection/review/IDB affordance composes these contracts, not a new public endpoint.

## Evidence boundaries

Focused tests cover the pure plans and actual BinderApp-hosted BrowserSession, IndexedDB, HTTP handlers, response parsing and fresh-read ACK. The loopback harness uses explicitly synthetic auth, catalog, RPC ledger and Activity/recovery engines; it is not hosted SQL or transactional audit proof. Existing SQL/recovery tests remain their own proof tier. Browser/standalone emulation at 375, 390 and 430 px is not a physical-device test. Cached document reload with inventory reads unavailable proves IDB retention and read-only startup, not cold service-worker relaunch. No full e2e suite, production writes, grants, conversion, publication, merge or deployment is claimed.

## UI craft self-review

| Before | After | Reason |
| --- | --- | --- |
| Detail exposed location/grading only | Raw actions stay with the selected physical copy; destructive confirmation names its ID and consequences | Keep ownership and storage intents distinct |
| Expanded ACK controls crowded 375 px standalone copy rows | Existing exact-history controls behind a 44 px disclosure | Keep the Inventory usable after sync |
| Copy scroll alignment could put its center at 579 px against the 579 px dock top in 375 px standalone | Dock-aware scroll margin puts the center at 503 px; collapsed history is 68 px tall | Keep copy actions hittable after ACK |
| Long consequence reviews could scroll confirmation out of view | Existing confirmation controls stick inside the scrolling review | Keep review and cancel reachable without scrolling |
| Occupied slots excluded | Explicit unassignment or compatible swap with both-copy and retained-goal review | Avoid silent displacement or duplicate ownership |
| No direct Unassigned add | Catalog selection previews a separate Raw copy and offers inspection of existing copies | Avoid silently cloning or relabelling ownership |
| No ownership sheet | Shared focus/history/backdrop/swipe primitive, 44 px controls, 16 px inputs, scrolling body and dock/safe-area clearance | Match current phone and standalone behavior |

No entrance/exit motion or new gesture implementation is added. Existing shared
swipe dismissal remains authoritative. Phone emulation and layout attachments
cover geometry; real-device keyboard, touch and screen-reader behavior are not
claimed.

## Explicit raw multiselect, staged #383/#385

Inventory retains only individually checked distinct raw IDs, in selection order, across current pages and filters. The selected count includes hidden selections; Clear selection clears all of them. There is no select-all or implicit unseen selection. Graded rows retain disabled bulk selection and can be placed individually.

Bulk review maps every selected copy explicitly to a distinct compatible empty saved slot, or unassigns every selected placed copy. It composes the per-copy planner against one base, then parses and projects the combined request once. Occupied destinations cannot be selected, even if another selected copy would leave them empty. #493's individual displacement/swap choices remain intact. Unknown identities retain original metadata and enter only free slots unless catalog evidence proves compatibility. The same complete references and no-inferred-want/acquisition semantics apply.

One request must fit the existing 100 commands, 256 work units, 32 collections and 262144 UTF-8 bytes; 85 placed moves fit the work budget and 86 fail as a whole. No selection truncation, chunking or multiple sends implements a single review. The existing ownership receiver reauthenticates scope with a fresh complete read, then fences revisions, every exact command reference, ordinary/deletion/restore/creation/legacy pending intent and unresolved recovery at durable admission. A retained unacknowledged creation also blocks ownership. No queue/backend/SQL/restore-schema change is added.

All commands use the same operation and durable receipt. Unknown results retain original bytes and ID through reload and retry. The existing exact acknowledged Activity link and authoritative conditional recovery own subsequent history, with no local inverse. REST/MCP callers compose the existing commands as one request with `privateFields:"preserve"`, exact references, `occupied:"cancel"` and `fulfillWant:null`. Generated registry/OpenAPI remains unchanged. Help is in `content/docs/native-storage.mdx`; unpublished release copy is `docs/releases/raw-inventory-bulk-draft.md`.

| Before | After | Why |
| --- | --- | --- |
| Only single-copy actions | Individual 44 px selection labels and explicit total/clear controls | Keep paginated/filter-hidden selection visible |
| No bulk review | Shared dock-aware sheet with ordered exact IDs and locations, explicit empty-slot choices and sticky confirmation | Keep every mapping reviewable on small phones |
| One action per copy | One bounded combined request, whole-selection rejection | Preserve atomic intent without protocol changes |

No new motion is introduced. Shared swipe/history/focus/backdrop dismissal is reused. Synthetic six-phone loopback tests are browser/IDB/HTTP/fresh-read evidence, not hosted SQL, provider, physical-device or production-enable evidence. Parent owns release, issue/project state and whole acceptance; #383/#385/#379 remain open.


## Exact graded-copy placement, staged #383/#385

Existing `assign` with an exact Unassigned selection, `move` and `unassign` accept graded items. Migration 075 locks the selected item and exact placement, matches forward and reverse targets and writes placements/slots only; inventory-item grading updates belong exclusively to `edit`. The atomic projector likewise retains the original items. All occupied decisions, complete reads, durable admission, sender/replay/fresh ACK and exact Activity lookup use the existing flow. Native admission remains fixed503 and conversions remain zero.

Focused synthetic preservation cases cover known and custom providers and all private fields, compatible graded-to-graded swaps/displacement, unknown identity, and blocked removal/bulk. Six-phone component/host cases cover graded review/cancel, assign/move/unassign, private-field retention, lost reply/cached reload/exact replay, separately fresh ACK and exact Activity event selection. SQL is inspected, not executed or changed by this slice. Full e2e, hosted SQL/audit, physical-device proof, independent review, enablement and release remain parent gates. No provider renderer or restore/recipient/legacy queue changes. Unpublished copy: `docs/releases/graded-inventory-placement-draft.md`.

| Before | After | Why |
| --- | --- | --- |
| Graded detail hides all placement actions | Same exact-copy placement review as raw copies | Reuse supported contracts and retain private metadata |
| Graded removal has no UI | Explicit unavailable explanation, no removal command | Existing inverse cannot verify private assets |
| Bulk relies on the individual raw-only guard | Explicit raw-only bulk admission | Keep the selected-copy expansion bounded |

No layout or motion primitives changed; shared dismissal, dock clearance and sticky confirmation remain. Missing grade/identity data and custom provider text are exercised without publishing private certificate or asset values in review.
