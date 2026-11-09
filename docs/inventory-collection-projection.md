# Inventory collection projection, staged #374 slice

Related: #374, #382, #385, #386, #379. Internal preparation only. Public inventory/slot routes remain hard 503; this does not enable or migrate any collection. No schema, hosted writes, grants, conversion, acquisition events or command changes.

## Actual consumers

`buildInventoryBrowseIndex` validates scope, complete branding or explicitly cached evidence, then calls `projectInventoryCollection`. Existing `InventoryView` consumes the result for:

- All storage and selected storage owned-copy totals, explicit wants and known species statistics.
- Its existing owned-copy list and search, including repeated printings, Trainers and Energy, with saved raw quotes per copy.
- Read-only explicit wants by destination, preserving collection ID, slot ID and per-slot entry index. Two identical wants in different slots stay separate.

All storage includes Unassigned. Selected storage includes only its primary placements. Item IDs are ownership identity; neither a showcase reference nor target art adds ownership. Targets do not create explicit wants. Species IDs are deduplicated only for species statistics, not copies. `pokemonIds: []` means an attested card with no Pokémon association; omitted evidence becomes `null`, not a guessed species. Legacy species-only inventory retains its species and unknown printing. The private complete-read catalog adapter now supplies the mirror's numeric dex links, and its JSON validator accepts/validates this optional evidence. Old cached catalog entries without IDs remain usable with unknown associations.

## Narrow host boundary

No BinderApp host/navigation edits. The existing `InventoryView` props remain compatible. Supply the current authenticated `scope`, `evidence`, `catalog` and `layouts` from the established complete/navigation read. The optional `pricingRegion` prop selects existing regional quote rules, default UK. Amounts on this view are explicitly GBP references. Clear evidence on account/owner/session/membership changes using the existing host contract; the projection is neither authentication nor another store.

`projectInventoryCollection(validatedSnapshot, catalog, collectionId?)` is the shared pure read adapter. `selectInventoryCollection(projection, collectionId?)` selects storage from an existing projection. `owned` retains item ID, primary placement, nullable species metadata, grading flag and acquisition timestamp. `wants` retains every explicit destination. `priceIdentities` deduplicates canonical card/language/finish; `priceRequests` deduplicates card/language because the existing saved-price transport returns all finish evidence together. Missing/ambiguous catalog identity, unknown language or unknown finish never defaults to English/normal.

Do not convert this projection into a Pokémon-keyed collection map. Do not feed it to legacy mutation handlers. It supplies no mark-owned callback; a future action must use the existing trusted command boundary and an explicitly selected stable slot. Repeated matching destinations cannot be silently collapsed.

## Saved-price API boundary

`useInventoryPrices` calls only existing `GET /app/api/card-prices?cards=<encoded JSON>` with at most 25 distinct card/language identities per request. This is saved evidence, no POST refresh, paid comparison or provider calls. One mounted Inventory view loads owner-wide quote requests once, so changing storage/search/copy filters reuses them. Response identities are validated, duplicate/unrequested quotes fail closed, and requests abort on teardown. There is no new REST/MCP operation, permission or generated OpenAPI change: public parity remains the existing `get_prices` / `POST /app/api/v1/prices/query` saved-evidence operation. The projection is an internal presentation adapter, not a new collection endpoint.

`valueInventoryCollection` selects exact standard finish evidence through existing regional helpers and applies existing freshness caps. It never falls back to a printing headline for an absent finish quote, guesses a price, invents FX or creates buy/Rising/Breakout signals. It returns the selected quote's confidence, freshness/source/finish evidence. Each raw physical copy receives the same identity quote once. Graded copies have unknown market value; a raw reference is explicitly labelled and excluded from raw totals. No grade multipliers or graded-value claim.

Totals follow the storage selector before search/assignment/grading filters and pagination. Raw totals are partial when raw copies are unpriced; graded unknown counts are separate. Failures stay unknown. Loaded quotes remain available while the mounted view goes offline. No new persistence/cache shape or service-worker behavior is added. Cached-only input shows subset totals labelled Cached only; it never claims owner completeness. Reopening offline without loaded price evidence leaves prices unknown.

## Remaining #374 integration

This slice does not adapt legacy `use-all-binders`, Pokémon-keyed card-browser/search badges, legacy analytics/value/dashboard previews, Show hunt/price-check inputs, wanted-to-owned transitions or the refresh workflow/acquisition selection queries. Their legacy behavior is preserved. Show must retain non-Pokémon wants and choose a stable destination before invoking a command. Refresh must select distinct saved identities across supported storage and avoid duplicate provider calls. The host lane must pass its current read evidence and chosen pricing region. #374 stays open; #379 gates, independent review, hosted verification and publication belong to the coordinator.

Verification is recorded on the PR. See [unpublished release copy](releases/inventory-collection-projection-draft.md), which must not be published as an enabled feature.
