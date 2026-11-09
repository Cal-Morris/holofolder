# Staged ordered-slot display (#364)

This is an internal read adapter, not an enabled inventory API or a second binder app. Production startup, legacy sharing, local/offline collection writes and compatibility keys remain authoritative and unchanged. New inventory/slot routes still return unconditional 503. Nothing here authorizes conversion, hosted writes or SQL execution.

## Shared rendering boundary

`lib/binder-display-model.ts` supplies ephemeral `BinderDisplaySlot` values to the existing `renderBinderGridPageView` and `DashboardBinderPreview`. `adaptLegacyDisplaySlots` retains the current Pokémon slot component, actions and species-based legacy data access. Its scoped `legacy:` keys are display keys only, never persisted conversion mappings. The existing binder shell, appearance, paging controls and 3D renderer remain shared.

`buildSlotDisplay` consumes a coherent `BinderSnapshot` present in an `InventorySnapshot`, checks structural owner/placement/reference consistency with the accepted normalizer and retains references to actual inventory items. It does not authenticate a reader or prove that a structurally valid snapshot is complete. #363 must supply authenticated, complete, revision-consistent owner reads before runtime wiring. Catalog presentation is a separately supplied card-ID lookup; missing catalog data shows the identity, never guessed Pokémon metadata or an invented printing.

Display values must never be serialized back into storage commands: versions and preset origin remain on the source slot. Future editing must resolve the stable ID back to that authoritative slot so whole-slot moves preserve all metadata.

Slots retain ordered opaque IDs independently from species, printing and item IDs. Two Snorlax targets with two copies open different details. Pokémon targets, exact card targets and free slots have different accessible labels; unfilled art is explicitly an Unfilled target. A stored free slot remains an Empty spacer even at the end of a page. Trainers and Energy never acquire a fake dex ID. Every slot remains selectable independently, including unfilled targets and spacers.

`paginateDisplaySlots` supports every rows/columns pair from 1 through 8. Filters mask positions rather than compacting or sorting the saved order. Null trailing padding has no slot ID, item, target or action. An empty binder has zero model pages; the existing navigation shell retains a single empty visual page. The 3D shell likewise retains an empty inside cover without inventing a slot. Custom grids retain the existing internally scrollable pocket region so 8-column touch targets remain usable without document overflow.

Card image content remains URL-addressed by the existing image loader/cache. Slot component keys, selection IDs and 3D placeholder texture keys use stable slot identity; a target texture cannot reuse an Owned label. 3D keeps the proxy URL form required by its existing artwork allowlist. Legacy card appearance is otherwise retained. Image failures remain ordinary missing artwork, not replacement card data.

## Read-only staging and grading

Only the `HOLOFOLDER_E2E=1` harness supplies `BinderApp.stagedSlotDisplay`. Production bootstrap, offline shell and share routes do not supply it. Supplying the internal prop forces the app's existing read-only guard. The staged slot component exposes selection only, with no drag, long-press, double-tap mutation, insert, clear, delete, bulk or keyboard move callback. The ordinary detail overlay uses the shared overlay/history/focus/swipe primitive and closes on dock navigation. Page, filter and presentation navigation clears transient selection. The staged slot path currently displays the referenced item, independent of legacy Owned/Wanted preview controls; wants remain metadata and never create ownership.

Grading text comes only from the referenced item's recorded provider, grade, scale, designation, subgrades and holder. Unknown grades stay unknown. No certificate, provider verification link or private label asset is exposed by this staged surface. There is no slab simulation or invented holder design. Provider-faithful holders and presentation policies belong to #388/#389. Switching 2D/3D changes no item or placement.

## Remaining integration gates

- #361/#363: authenticated complete reads, durable guest acceptance, legacy mappings, account/owner switching, saved startup/offline shell and image warm-up rollout. The staged renderer does not enqueue new mutations or replace the old queue. Structural normalization alone is not complete-read authorization.
- #394/#396: transactional audit and recovery. This UI records no synthetic audit events and owns no schema or recorder work.
- #369/#370: explicit **Edit layout** before all single/bulk/keyboard/button moves, inserts and removals. There is deliberately no Edit layout control in this slice. Downstream tests must cover Done/cancel/undo, leaving the view and a touch that began in Browse mode before editing was enabled. Movement must preserve the whole slot (target, item reference, wants, preset origin) and bulk relative order. Clearing placement must leave the copy Unassigned, never delete inventory implicitly.
- #376: transport operation registry and truthful REST/MCP/OpenAPI contracts. This internal UI adapter adds no supported endpoint, mutation, generated API schema or public read permission.
- #379: enable core rollout only after #361/#363/#394/#396 and backup/conversion gates. Existing private backups are untouched. Parent owns independent review, serialized merge and production verification.

#364 remains open: this is focused shared-renderer proof, not completion of the entire rollout or editing acceptance matrix. Legacy non-binder screens and jump/search/scanner/valuation flows still use species context; migrating those consumers, enabled slot-aware sharing and on-device snapshot bootstrapping must be reviewed at the owning rollout boundary. No user-facing help/Framer announcement is appropriate for hidden harness foundations.
