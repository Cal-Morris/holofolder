# Raw Inventory ownership actions, staged

Related: #383/#385. This is current native app preparation, not enabled production behavior. Production native admission and first-party inventory writes stay fixed private/no-store 503. No schema, grants, conversion, queue protocol or executor change is included.

## Device flow

The authenticated `BrowserCollectionSession` supplies a complete owner-wide private snapshot and its existing durable command sink to Inventory. New actions require a current online complete read, current account/session/owner, no pending command (including creation), no legacy intent and no unresolved recovery. Cached/unavailable Inventory stays read-only. The sink rechecks the active scope, inventory revision, IDB record and pending/recovery gates immediately before enqueue; existing queue admission, send leases and server current owner/partner/billing checks remain authoritative.

- **Add owned card** reuses the slot catalog search UI and catalog/finish rules. It previews a distinct Raw copy as Unassigned and uses existing `add`, with explicit new item and operation IDs, null grading/acquisition date, and no collection preconditions. Existing copies of the selected printing can be inspected; **Add another raw copy** never modifies/reuses a raw or graded duplicate. Catalog language is a search filter; missing selected identity metadata stays missing.
- **Assign copy / Move copy** operates on the selected physical item ID/version and exact placement, using existing `assign` with `selection.kind=existing` or `move`. The user deliberately chooses a compatible empty stable slot across current authorized storage. Unknown catalog evidence permits free slots only. Unknown language/finish cannot satisfy constrained targets. The source/destination collection, layout, slot, item and placement versions are captured. Occupied slots are excluded; this slice does not implement swap/displacement UI. No wanted entry is implicitly fulfilled (`fulfillWant:null`).
- **Unassign copy** retains the item, identity, acquisition/source metadata and ownership count. Its source slot becomes unfilled, keeping target, wants, provenance and order.
- **Remove owned copy** previews the exact copy ID, source storage/stable slot or Unassigned, ownership decrement, cleared placement and retained slot goals/order. Other copies are unchanged. Only confirmed existing `removeOwned` deletes ownership.

Previews use `parseSlotIntent` and `projectSlotIntent`. Confirmation retains the exact immutable request through local failure and retries. Local acceptance means committed IndexedDB only. Existing sender/HTTP bridge, trusted audit context and a separate fresh complete all-stream read govern remote ACK. An unknown response retains the original intent and operation/item IDs, with no fabricated acquisition, receipt, history or Undo.

## Recovery and deliberate limits

After synchronized removal, the existing Activity entry owns recovery preview and confirmation. The existing private event payload preserves the original item ID, metadata and placement; current permission, version, dependency, billing and plan-token checks still apply. A newer placement must never be displaced: Activity can explicitly restore the removed item as Unassigned. Unsupported/incomplete history is reported by that existing recovery boundary. This slice adds no local inverse, new restore operation, or instant Undo promise.

Bulk ownership actions, occupied-slot decisions, graded-copy ownership management and new arbitrary unknown-printing creation are outside this raw slice. Unknown existing printing identities can be retained/moved/unassigned/removed without replacing them with guessed catalog cards. Complete current scope, hosted admission, conversion/old-client and independent production proof remain parent rollout gates. Creation proof from #481 must be retained when integrating this additive BrowserSession binding.

## API composition

No API/schema operation is invented. Existing staged REST `POST /app/api/v1/storage/inventory/commands` and MCP `execute_inventory_commands` express `add`, explicit `assign`/`move`, `unassign` and `removeOwned`. Developer clients use `privateFields:"preserve"`, exact public references and `fulfillWant:null` so they do not reconstruct private metadata from browse DTOs. Existing staged recovery preview/apply operations own restoration, with current scopes and confirmation. First-party commands use `/app/api/inventory`, the existing trusted adapter and private complete-read boundary. All native production paths remain denied as before. No registry change means generated OpenAPI is unchanged. The device-specific selection/review/IDB affordance composes these contracts, not a new public endpoint.

## Evidence boundaries

Focused tests cover the pure plans and actual BinderApp-hosted BrowserSession, IndexedDB, HTTP handlers, response parsing and fresh-read ACK. The loopback harness uses explicitly synthetic auth, catalog, RPC ledger and Activity/recovery engines; it is not hosted SQL or transactional audit proof. Existing SQL/recovery tests remain their own proof tier. Browser/standalone emulation at 375, 390 and 430 px is not a physical-device test. Cached document reload with inventory reads unavailable proves IDB retention and read-only startup, not cold service-worker relaunch. No full e2e suite, production writes, grants, conversion, publication, merge or deployment is claimed.

## UI craft self-review

| Before | After | Reason |
| --- | --- | --- |
| Detail exposed location/grading only | Raw actions stay with the selected physical copy; destructive confirmation names its ID and consequences | Keep ownership and storage intents distinct |
| No direct Unassigned add | Catalog selection previews a separate Raw copy and offers inspection of existing copies | Avoid silently cloning or relabelling ownership |
| No ownership sheet | Shared focus/history/backdrop/swipe primitive, 44 px controls, 16 px inputs, scrolling body and dock/safe-area clearance | Match current phone and standalone behavior |

No entrance/exit motion or new gesture implementation is added. Existing shared
swipe dismissal remains authoritative. Phone emulation and layout attachments
cover geometry; real-device keyboard, touch and screen-reader behavior are not
claimed.
