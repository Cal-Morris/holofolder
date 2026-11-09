# Editable binder contracts

## Implementation status

Issue [#360](https://github.com/Cal-Morris/holofolder/issues/360) is being delivered additively. The internal contracts implement target validation/matching, stable slot/snapshot normalization, copied content presets and pure layout plans. Inventory/placement execution, schema, offline reconciliation and UI/API cutover remain downstream work. Nothing here changes the existing collection API, database or binder UI. Inventory identity belongs to #382; the core public rollout is gated by #379.

## Targets and candidates

A `SlotTarget` constrains a slot's contents, not its position:

- `{ kind: "pokemon", pokemonId }` accepts known catalog links for that Pokémon, including a multi-Pokémon card containing it. Positive safe-integer validation does not assert that the species exists; preset creation and writes must check catalog existence.
- `{ kind: "card", cardId, language?, finish? }` accepts that printing or its reviewed catalog canonical/alias IDs. Matching reuses `matchesCatalogCardId`; it does not compare names or guess aliases. Optional language/finish restrict the match only when explicitly present. Unknown candidate metadata cannot meet an explicit constraint.
- `null` represents a free slot. It can accept any card, or an existing legacy species-only owned item whose printing is unknown. The latter stays unknown rather than acquiring a guessed printing or grade.

`normalizeSlotTarget(unknown)` returns a detached valid target, `null` for an explicitly free slot, or `undefined` for invalid/missing input. Callers must reject `undefined`; they must never coalesce it to `null`, which would silently remove a constraint. Unknown keys or unsupported constraints are rejected rather than dropped. Language/finish values use the shared exact domain IDs, without the legacy English/normal defaults.

`matchesSlotTarget(candidate, target)` takes validated domain values. A card candidate supplies its exact ID, trusted catalog canonical/alias metadata, known Pokémon links, and optional recorded language/finish. A legacy candidate supplies only a known Pokémon ID; it cannot match a card-printing target. The matcher establishes compatibility only. It does not assign or duplicate ownership, select an Unassigned copy, fulfill wants, mutate layout, or validate an occupied target edit.

Catalog enrichment and authorization remain the responsibility of the authoritative adapter/write boundary. Do not trust client-supplied alias or Pokémon membership as proof when accepting a server write. Slot targets do not contain provider, grade or certificate constraints.

## Delivery boundary

This internal pure-contract slice exposes no new REST/MCP operation or customer feature, so generated OpenAPI and marketing claims remain unchanged. Future exposed slot operations must ship their API/docs under `feature-api-docs`, with supported schemas/permissions/conflict handling from #362/#376. Actual user-facing delivery requires the #379 gates, audit/recovery, and the matching Framer release/feature updates.

Verification: `bun test tests/binder-slot-targets.test.ts tests/domain-cards.test.ts tests/card-catalog.test.ts` covers malformed/unsupported targets, exact optional constraints, catalog aliases, multi-Pokémon links, synthetic non-Pokémon cards and honest legacy unknown printing.

## Stable slots and snapshots

`BinderSlot` in `lib/domain/binder-slots.ts` has these fields:

| Field | Contract |
| --- | --- |
| `id` | Stable slot identity, independent of Pokémon, printing, item and array position. Repeat printing IDs never collapse slots. |
| `ownerUserId`, `collectionId` | Owner and storage collection scope. `collectionId` maps to the existing binder ID at the future adapter boundary; it is not a second binder identity. |
| `target` | Validated Pokémon/card target, or explicit `null` for a free slot. |
| `inventoryItemId` | One referenced owned copy, or `null`. No card identity, grading or acquisition payload is copied into the slot. |
| `wantedCards` | Explicit choices using the existing shared `WantedCard` type, including optional language/finish and `wanted_by`. An empty target does not create a choice. |
| `status` | Existing shared `SlotStatus`, or `null` for no explicit state. `collected`/`finalized` require an item reference, and an item reference requires one of those owned states. `considering`/`wishlisted` carry explicit non-owned intent. |
| `version` | Nonnegative safe integer for slot content changes. Moving the whole slot does not change it. |
| `presetOrigin` | Copied `{ source: { id, version }, entryId }`, or `null`. Informational provenance, never a position lock or hidden completion requirement. |

`BinderSnapshot` contains `ownerUserId`, `collectionId`, `layoutRevision`, ordered `slots`, and `presetManifest` (or `null`). The array is the saved arrangement; slots have no competing position field. IDs are nonempty, trimmed opaque strings up to 200 characters, supporting future offline/guest IDs. Persistence adapters must validate/map database UUIDs and establish authorization independently. Revisions are nonnegative safe integers, with overflow rejected by plans.

`normalizeBinderSlot` and `normalizeBinderSnapshot` return detached values or `undefined` for invalid input. Missing fields, unknown keys, unsupported statuses/constraints, invalid revisions, malformed wants or provenance fail the whole value. There are no silent field drops or defaults to English/normal. Snapshot validation additionally rejects duplicate slot IDs, duplicate non-null item references, mixed owner/collection scopes and provenance pointing outside the copied manifest. Repeated card/Pokémon targets are allowed. Provenance may reference an original target different from the edited target; removed entries remain only in the historical manifest. A manifest is not a list of slots to recreate.

Normalization validates shape, not catalog existence, inventory ownership, trusted URL policy or assignment compatibility. Existing `CollectedPokemon` rows and current APIs remain unchanged. The #361 compatibility adapter must map legacy species-only ownership to real #382 inventory IDs, preserving the unknown printing and shared statuses/wants. Mark-owned-without-printing is valid for a Pokémon target when its referenced legacy item resolves to a species-only candidate. It does not produce a guessed printing and cannot fulfill a card target.

## Copied content presets

`lib/domain/binder-presets.ts` defines `PresetDefinition` as `{ source: { id, version }, name, entries: [{ id, target }] }`. Entry IDs distinguish repeated targets; `null` entries are explicit free spacers. `PresetManifest` has the same data shape but means the detached copy stored with a collection. These are **content presets**, separate from appearance presets in `binder-design-presets.ts` and row/column page-size settings.

`normalizePresetDefinition`/`normalizePresetManifest` reject malformed metadata, duplicate entry IDs and invalid targets. `instantiatePreset(definition, { ownerUserId, collectionId }, slotIds)` returns a new snapshot or `undefined`. Callers supply one distinct stable ID per entry so offline creation/retries can reuse identities; no UUID generator, clock, catalog lookup or side effect is hidden here. Each slot starts at version 0 with no item, wants or status, copied target/provenance, and snapshot layout revision 0. Definition, manifest, slot targets and separate instantiations do not share mutable nested data. Later source/catalog changes do not rewrite saved targets or metadata. Blank definitions have an empty entry list and create zero slots; adding intentional empty pockets is an explicit insert.

## Pure operation plans

`lib/binder-slot-plans.ts` takes validated snapshots and returns detached plans. Every function also validates the snapshot before planning. Signatures use the same leading `(snapshot, expectedLayoutRevision, ...)` arguments:

| Function | Remaining arguments and effect |
| --- | --- |
| `planInsertSlots` | `(emptyFreeSlots, beforeSlotId)` inserts new version-0 free slots before an existing stable anchor, or appends when the anchor is `null`. Existing slots shift forward intact. |
| `planMoveSlots` | `(slotIds, beforeSlotId)` moves whole selected slots before an unselected anchor, or appends with `null`. Saved relative order wins over selection input order. |
| `planClearSlots` | `(slotIds)` clears item references and owned status, retaining slots, targets, explicit wants and provenance. Already empty slots are unchanged, including explicit non-owned statuses. |
| `planRemoveSlots` | `(slotIds)` removes those slots, including their explicit targets/wants. Referenced items remain owned and become Unassigned. |
| `planChangeSlotTarget` | `(slotId, target, candidate?)` edits a content constraint without discarding an occupied item. Incompatible or missing candidate evidence rejects the edit. Making a slot free does not need candidate evidence. |

Insert-before is direct. To insert after, the adapter uses the next saved slot as the anchor, or `null` at the end. Bulk insertion shifts all following slots across page boundaries in one plan; no search for empty pockets or replacement occurs. Grid pagination is derived later and never part of this contract. Saved trailing free slots are explicit spacers and survive all operations unless selected for removal. Visual padding on an incomplete final page is implicit, has no stable IDs and is never persisted or counted.

Success is `{ ok: true, baseLayoutRevision, expectedSlotVersions, snapshot, unassignedInventoryItemIds }`. The snapshot is a preview of the result, not permission to replace all persisted rows. `unassignedInventoryItemIds` describes placement removals only, never inventory deletions or newly owned copies. `expectedSlotVersions` captures compare-and-set preconditions for changed/removed slot contents. Layout changes increment `layoutRevision` once; clear/target edits increment only changed slot versions. Whole-slot moves preserve each slot's version, item, wants and provenance. Identical moves, empty clears and identical target edits are no-ops without revision increments. Selection must be nonempty, unique and present; a move anchor cannot itself be selected.

Failure is `{ ok: false, error }`, with no partial result or input mutation. Errors are `invalid-snapshot`, `layout-conflict`, `invalid-selection`, `invalid-anchor`, `invalid-insert`, `invalid-target`, `occupied-target`, and `revision-overflow`. These are internal planning errors, not new HTTP response contracts. Adapters must surface conflicts without silently retrying against newer intent. A rejected occupied target edit requires a separate explicit unassign/move/replacement decision; there is no force/discard flag.

`canChangeSlotTarget(slot, target, candidate?)` and the target plan use the existing matcher. Candidate evidence must describe that slot's actual referenced item. An alias-compatible target edit keeps the item and slot IDs; matching aliases never manufacture a second copy.

## Current-target completion and saved entries

`getBinderCompletion(snapshot, resolveItem)` reports `{ targetCount, completedTargetCount }`. Only non-null **current** slot targets enter the denominator. An assigned item with trusted compatible candidate evidence fulfills its one target; an empty target, wanted choice, explicit non-owned status, missing evidence or item assigned elsewhere does not. A free slot is outside the goal even if occupied. Legacy Pokémon-only identity can complete its matching Pokémon target. Zero targets returns two zero counts, without inventing a percentage. Removing a target immediately removes that requirement; copied preset entries never keep removed goals missing.

Empty targets and free spacers alone are neither explicit wants nor owned/billable saved entries. This slice does not alter billing totals; #362/#374 must retain existing allowance rules for actual owned/wanted entries. Completion aggregation across storage, inventory-wide counts and product UI remain downstream work.

## Authoritative adapter and API boundary

This is unused internal, isomorphic contract code. There are no new REST/MCP operations, public schemas, generated OpenAPI changes, customer help claims or Framer announcement. `docs/public-api/coverage.md` records this boundary. Runtime/API exposure remains gated by #362/#376/#379.

- **#382:** owns `InventoryItem`, `Placement`, grading and trusted item-to-`SlotTargetCandidate` resolution. It must verify owner-wide placement uniqueness and item identity; this snapshot can only check uniqueness inside one collection. Non-owning showcase references are not storage slots and cannot fulfill these targets.
- **#361:** owns schema and lossless legacy conversion. This slice requires no migration or live database changes.
- **#362/#383:** authenticate the actor, resolve current owner/partner membership and entitlements, load the authoritative item/catalog evidence, enforce item/slot/layout revisions and caller intent, then atomically commit only the planned changes and placement effects. Never trust client aliases, owner IDs, item IDs or a submitted preview snapshot as authorization. Layout plans must not overwrite newer untouched slot contents. Item and placement revision preconditions belong to #382; slot/layout preconditions here do not replace them.
- **#363:** preserves operation intent, stable IDs and original revision preconditions in offline work. A local plan is not a server-committed result or conflict recovery algorithm.
- **#369/#370:** require explicit Edit layout mode for insert/move/remove/bulk actions across touch, buttons and keyboard. The pure helpers have no browser state and do not implement or bypass that UI guard.
- **#394/#396:** own transactional actor/idempotency/audit and version-safe recovery. Executors must record one logical bulk operation and commit it with its changes; pure previews emit no audit events and promise no automatic undo.
- **#376:** defines exposed operation schemas, permissions, response/errors and generated REST/MCP docs with the runtime capability. #379 keeps exposure gated until compatibility/offline/audit/recovery checks pass.

Verification: `bun test tests/binder-slots.test.ts tests/binder-presets.test.ts tests/binder-slot-targets.test.ts tests/domain-cards.test.ts tests/card-catalog.test.ts` covers strict normalization, stable repeat identities, independent preset copies, whole-slot movement, Unassigned effects, conflict/no-op/overflow behavior, occupied edits and current-target completion. Pure contracts need no mobile/e2e run or production data writes; runtime integrations still need their own proof.

The additive [inventory contract](inventory-contracts.md) under #382 supplies the referenced item/placement/grading shapes, owner-wide uniqueness, trusted candidate adaptation and audit context. Whole-slot layout moves still preserve placement IDs; inventory moves change primary placement without moving the target. Schema and authoritative execution remain downstream.
