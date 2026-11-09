# Editable binder contracts

## Implementation status

Issue [#360](https://github.com/Cal-Morris/holofolder/issues/360) is being delivered additively. The first slice implements target validation and matching in `lib/domain/binder-slots.ts`. Ordered slots, copied preset manifests and layout operations are still pending. Nothing here changes the existing collection API, database or binder UI. Inventory identity belongs to #382; the core public rollout is gated by #379.

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
