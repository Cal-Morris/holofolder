# Internal inventory and placement contract

Related: [#382](https://github.com/Cal-Morris/holofolder/issues/382), [slot contracts](binder-slot-contracts.md), overall plan #357. Based on the #400 slot/preset merge, main `8c6b84c944139bd20c338f924a11de86cf813cc7`.

This is unused, pure contract code. There is no database migration, provider request, runtime cutover, UI or public operation. #360's production verification remains a separate prerequisite; merging code is not proof that its rollout gates passed. The restore-verified pre-implementation backup remains untouched. No live data writes are needed for this slice.

## Owned identity and storage

`lib/domain/inventory.ts` defines these shapes:

| Shape                       | Meaning                                                                                                                                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InventoryItem`             | `{ id, ownerUserId, identity, grading, acquiredAt, version }`, one physical copy with a stable opaque ID. Three copies of one printing are three items, even if their metadata is identical.                                        |
| `InventoryIdentity`         | `{ kind: "card", cardId, language?, finish? }` or `{ kind: "pokemon", pokemonId }`. Card variants reuse `CardLanguage`/`CardFinish`. Omitted variants stay unknown, without English/normal defaults.                                |
| `Placement`                 | `{ inventoryItemId, collectionId, slotId, version }`, exactly one primary storage location per assigned item. Absence means Unassigned.                                                                                             |
| `StorageCollection`         | `{ id, ownerUserId, name, kind, defaultPresentation, version }`. `id` maps to the existing binder ID, with no second collection identity.                                                                                           |
| `InventoryDisplayReference` | `{ inventoryItemId }`, a non-owning pointer, with no primary placement, quantity or copied owned payload.                                                                                                                           |
| `InventorySnapshot`         | `{ ownerUserId, inventoryRevision, items, placements, collections, binders }`, a complete owner-scoped view for pure planning and invariant tests. `binders` are the existing `BinderSnapshot` shape, shared by every storage kind. |

An item has zero or one placement; a slot references zero or one item. Slots retain their existing targets/order/wants/status/preset provenance and only `inventoryItemId` for ownership. They never embed printing, acquisition, grading or certificate data. Empty targets and explicit wants create no item. A raw copy has `grading: null`.

Legacy species-only ownership remains `{ kind: "pokemon", pokemonId }`, with unknown printing and `grading: null`. It can fulfill its species target or occupy a free slot, never an exact printing target. Conversion must create one item per existing owned row, even for matching printings in different binders; catalog aliases and certificates are not deduplication keys. Wanted-only rows create no item. `acquiredAt` preserves a known existing timestamp, or `null` when unknown. Selection/moves preserve it; no clock, inferred purchase date or invented acquisition data is hidden in a planner. Existing acquisition/notification intents still belong to the authoritative operation adapters, not to the grading record.

Storage kinds are `binder`, `slab`, `custom`, with default presentations `binder`, `slabs`, `list` respectively. `defaultPresentation` may independently select any of these presentations. Viewing a binder as slabs does not grade a raw card, move anything or alter counts. There is no fake Unassigned binder, nested storage hierarchy or per-partner visibility model.

`normalizeInventoryItem`, `normalizeGradingRecord`, `normalizePlacement`, `normalizeStorageCollection` and `normalizeInventorySnapshot` return detached valid values, or `undefined` on invalid input. `normalizeGradingRecord(null)` retains explicit raw state. Missing fields, unknown keys, invalid revisions/IDs, invalid shared variants and unsupported identity combinations fail rather than silently losing data. IDs and versions reuse #360's `isSlotContractId`/`isSlotRevision`; persistence adapters independently validate UUIDs and authorization. The owner-wide snapshot additionally rejects duplicate item/collection/slot IDs, mixed owners, orphan placements, duplicate item/slot placement and any disagreement between slot references and placements. It requires one arrangement per storage collection. Shape validation does not authenticate ownership, verify catalog existence or validate asset access.

This snapshot is neither a transport contract nor permission to replace an owner's state wholesale. #361 chooses concrete tables and RPC boundaries; runtime workers must load complete relevant evidence with stable pagination beyond PostgREST's row cap, lock the relevant rows/index predicates, and commit bounded changes. A partial owner snapshot cannot support owner-wide counts or automatic no-match claims.

## Per-copy grading

`GradingRecord` contains recorded metadata, never a guarantee of authenticity or a graded price:

- `provider`: `{ kind: "known", id: "psa" | "ace" | "cgc" | "beckett" }` or `{ kind: "custom", name }`.
- `grade`: an exact nonempty string, including nonnumeric grades such as Authentic, or `null` for a recorded graded copy whose grade is unknown. A grading record with unknown grade remains distinct from a raw item. `scale`, `designation`, `certificate` and `holder` are explicit string-or-null fields. Preserve leading zeros and provider-specific wording.
- `subgrades`: ordered `{ name, grade }` string pairs, at most 20.
- `label`: `{ variant: string | null, assetIds: string[] }`, at most 20 opaque private asset references. These are not arbitrary provider URLs or public image links. Fields are bounded to 500 characters; asset IDs use the shared 200-character ID limit.

Provider-specific field validation/editing belongs to #387; label/holder rendering and assets to #388/#389; record links and supported lookup/autofill to #391/#392. No provider fetch, verification status, cookie, credential, numeric-grade conversion or guessed scale is added here. This private shape must not be serialized directly into a public share. Certificate/link publication stays off by default, with safe public label/image redaction handled by the owning sharing/grading integrations and #390.

## Trusted candidate adaptation and counts

`inventoryItemCandidate(item, resolveCatalog)` returns the existing `SlotTargetCandidate` union or `undefined`. A known card requires reviewed catalog canonical/alias evidence from the resolver; association with the stored card ID is checked through `matchesCatalogCardId`. Pokémon links come only from that evidence. Recorded language/finish come from the item, never from catalog defaults. A legacy item becomes the species-only candidate without guessing a printing. Returned arrays are detached.

The resolver must be populated from the authoritative catalog at the server boundary. This callback and its values are not accepted from a client, backup or offline queue as trusted proof. Neither normalization nor a matching result provides authentication. Assignment uses `matchesSlotTarget` from #360 for constrained targets, including alias, multi-Pokémon and exact language/finish behavior. Explicit assignment/moves of an already owned item to a free slot need no catalog evidence, because there is no content constraint to check. Catalog selection still requires reviewed evidence for printing identity/reuse/new-copy creation.

`getInventoryItemLocation` returns a detached placement, `null` for an existing Unassigned item, or `undefined` for a missing item. Callers can label already-assigned items with their storage location instead of silently using them in another collection. `getInventoryCounts` reports `{ total, assigned, unassigned, byCollection }` on a complete valid snapshot. Counts deduplicate by item ID, never printing ID. `total = assigned + unassigned`; each per-storage count includes primary placements only. Wants, targets, spacers and display references are excluded. This is ownership arithmetic, not a change to billing/price rules, which remain #374's responsibility.

`getStorageCompletion(snapshot, collectionId, resolveCatalog)` adapts #360's current-target completion through actual primary placements. A display reference or item located elsewhere cannot fulfill a target. Unknown catalog evidence is incomplete; free slots are outside the target denominator. Missing storage returns `undefined`. Repeated exact targets require separate placed copies.

## Pure commands and outcomes

`lib/inventory-plans.ts` takes validated typed commands, validates a detached snapshot and returns a preview without side effects. Every command includes `{ inventoryRevision, context: AuditContext }`. Runtime input schemas/authentication are still required; typed planner inputs are not an HTTP parser.

`InventorySlotRevision` is `{ collectionId, slotId, layoutRevision, slotVersion }`.

| Planner                                                | Additional input                                                              | Behavior                                                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `planAssignInventory(snapshot, input, resolveCatalog)` | `destination`, `selection`                                                    | Assign Unassigned existing copy, or automatically reuse/create through catalog choice. Replacement retains the displaced item as Unassigned.               |
| `planMoveInventory(snapshot, input, resolveCatalog)`   | `inventoryItemId`, `itemVersion`, `placementVersion`, `source`, `destination` | Explicitly move a placed item across or within storage, emptying its former slot and unassigning displaced destination contents.                           |
| `planUnassignInventory(snapshot, input)`               | Same placed-item input and `source`, without destination                      | Remove primary placement and owned slot status, retaining the item and target/wants/provenance.                                                            |
| `planReleaseInventorySlots(snapshot, input)`           | `collectionId`, `layoutRevision`, `slotVersions: Record<slotId, version>`     | Release selected contents for clear/remove/collection deletion, retaining every owned item.                                                                |
| `planEditInventoryMetadata(snapshot, input)`           | `inventoryItemId`, `itemVersion`, `grading`                                   | Edit recorded per-copy grading only, preserving item ID, printing, acquisition timestamp and placement. Raw/graded transitions do not create another item. |

`selection` has two explicit forms:

- `{ kind: "catalog", identity: { kind: "card", cardId, language?, finish? }, newItemId }`: use matching Unassigned items, ignoring placed copies. Matching requires canonical printing and exact selected variant values, including unknown versus known variants. Materially different grading records return `copy-choice-required`; the picker must show Raw and recorded grade/copy choices. Indistinguishable candidates choose by stable lexicographic item ID. If no eligible item exists, create the supplied unused ID as a **raw** item in the destination, with canonical catalog ID, version 0 and unknown acquisition timestamp. No extra existing/new prompt is required.
- `{ kind: "existing", inventoryItemId, itemVersion }`: assign that exact Unassigned item, preserving grade/certificate/acquisition. Missing/edited item or any current placement conflicts. It never falls back to catalog creation, copies a certificate or silently moves the selected item. A changed owner revision also conflicts, including when an Unassigned item has since been claimed and released.

Clients preserve their original selection kind through offline replay. Choosing a particular graded copy uses existing-item selection; stale explicit intent must not be weakened into generic selection. Already-assigned copies require the explicit move command with source revision/placement evidence. A lost response must replay the same accepted operation ID through the future server idempotency boundary, not replan as an extra physical copy.

Success is `{ ok: true, snapshot, selectedInventoryItemId, preconditions, context, changed }`. The selected ID is null for bulk release, including empty release effects. `snapshot` is a detached preview, not an authoritative write payload. `preconditions` contains independent maps: owner `inventoryRevision`, `items` (version or null for required absence), `placements` (version or null for required absence), `slots`, `layouts`, and storage `collections` metadata versions. Displaced item/placement preconditions are included too. The owner inventory revision protects the automatic scan's absence predicate and placement absence/ABA; schema/runtime workers must enforce equivalent serialization, not merely CAS the destination slot. No owner revision increments for no-ops. Real inventory/placement/metadata changes increment it once. Item version changes only on item metadata edits; placement moves increment placement version; a first assignment starts at 0. Unassignment deletes the placement; reassignment starts a new placement at 0, protected against ABA by owner revision. Slot content changes increment slot version; inventory commands never change layout revision. Versions cannot overflow safe integers.

Whole-slot layout movement remains #360's `planMoveSlots`: it carries target/content/wants/provenance together and leaves placements unchanged because stable slot IDs do not move between collections. Inventory movement carries the item only and rechecks the destination target. They are distinct intents. Neither helper supplies the UI's Edit layout guard.

For clear/remove/delete, derive #360 and inventory-release plans from the **same** base, combine their preconditions and apply the slot/layout effects from #360 plus the placement removals from the release plan once in the same transaction. Do not apply two whole snapshots, double-increment slot versions or sequentially replan against already changed state. Collection deletion releases every occupied slot before deleting storage/slots; empty collections need no release plan. No inventory delete cascade is permitted. Explicit removal of a copy the user no longer owns is a distinct #383 operation, outside these planners. Wants are preserved and never automatically consumed by assignment; selected-want fulfillment is also #383's transaction responsibility.

Failure is `{ ok: false, error }`, with no partial snapshot or input mutation. Internal errors are `invalid-snapshot`, `invalid-context`, `invalid-selection`, `inventory-conflict`, `item-conflict`, `placement-conflict`, `layout-conflict`, `slot-conflict`, `invalid-destination`, `target-mismatch`, `catalog-unavailable`, `copy-choice-required`, `revision-overflow` and `invalid-grading`. They are not new public HTTP codes. #362/#383/#376 must define consistent external validation/conflict responses without silently retrying stale intent. Valid no-ops have `changed: false`, unchanged revisions and no affected IDs; they create no committed event.

## Audit context and trust boundary

`lib/domain/audit-context.ts` defines `OperationIntentContext` for original queued intent: `{ source, clientId, operationId, batchId, clientOccurredAt }`. Sources are `app`, `rest`, `mcp`, `import`, `system`, `migration`. Client/batch/time fields are explicit nullable values. This shape has no actor or arbitrary request payload. It retains offline intent and idempotency IDs; it is not committed history.

`AuditContext` adds `actor: { kind: "user", userId } | { kind: "system", job } | { kind: "unknown" }` and `affectedEntities: { inventoryItemIds, slotIds, collectionIds }`. A partner is the real authenticated user, distinct from the resolved collection owner; current membership must be rechecked. Unknown historical attribution stays Unknown. System attribution requires a trusted job boundary, not a caller flag. Server commit time belongs to the recorder; client occurrence time never substitutes for it.

`normalizeAuditContext` checks shape and makes a detached copy. **It does not authenticate actor/source/client.** Only #362/#383's authenticated server boundary may construct that attribution. Never deserialize an HTTP actor or later offline queue actor as trusted. #363 preserves original actor/account-owner scope and source intent, and reconciles account/partner changes without spoofing the eventual committer. Source/client claims must be checked against the actual transport/principal; keys, OAuth tokens, cookies, headers and provider credentials are never context fields.

Planners overwrite submitted affected IDs with sorted unique IDs derived from their actual effects. They retain actor and original operation/batch/source/client/time values. #394 owns extending the existing `collection_activity` recorder with these contracts, one logical bulk event and atomic mutation-plus-event commit, idempotent accepted operation IDs and no event for replay/no-op/rollback. #361 prepares compatible schema; #396 owns version-safe inverse/recovery semantics. There is no competing event table or recorder here. A successful preview does not mean an operation was committed, audited, authorized, billed or made replay-safe.

## Delivery and downstream owners

Public REST/MCP operation changes, OpenAPI generation, customer help and marketing are **not applicable** to this unused internal slice. Existing APIs keep their legacy payloads. [API coverage](public-api/coverage.md) records the exclusion; no customer feature is announced. This is an internal contract handoff, not completed core inventory delivery.

- #361: schema, RLS, constraints/indexes, owner revision/serialization, pagination and lossless hosted/guest legacy conversion; preserve actual copies and unknown identity.
- #362/#383: authenticate/resolve owner and partner, enforce billing and all revision/absence predicates, trusted catalog evidence, atomic assignment/replacement/move/delete and selected-want/acquisition effects.
- #363: durable original selection/operation IDs and revision intent, account/owner isolation, safe offline conflict reconciliation and replay.
- #376: shared registry, exposed schemas/permissions/errors and matching REST/MCP/generated docs when supported runtime operations ship.
- #387–#392: grading entry, private/public label assets, provider links/lookup/autofill and the separate final slab gate.
- #394/#396: transactional audit and safe recovery, required before core exposure.
- #379: core exposure after compatibility, backup, offline, sharing, audit and recovery gates. #393 and the owning feature block handle real production release communications after enabled deployment.

Verification uses synthetic fixtures in `tests/inventory-model.test.ts` plus the slot/preset/matcher/domain/catalog suites. No UI change needs a phone/e2e run here, and no full e2e, production build, provider call or live data mutation is part of this contract proof. Parent review, current-head CI and serialized merge/deployment verification remain separate delivery gates.
