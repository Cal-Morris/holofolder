# Binder and Custom creation UI, staged

Related: #384/#368/#379. Base: main `067d056166f12cc18e7f724f683f9d63a708c446`, including #487–#491. This is an additive app UI consumer of existing creation, not a rollout or backend change. Slab creation and gallery exposure remain owned by #390.

## Creation and presentation

The admitted native **Storage** menu offers **New storage**. Choose **Binder** or **Custom storage**, enter a name, and optionally enter a private location for Custom (trimmed, empty becomes null, at most 200 characters). The existing copied preset builder still offers Blank, National Dex, generation, ordered species and catalog printings. Set checklist persistence remains unavailable. Blank stores zero slots; targets, free slots and copied provenance never acquire physical copies, add wants or infer grades. Existing inventory, optional grading, placement and target metadata remain untouched.

Review explicitly shows kind, initial view, name, private location and copied target count. Back to preview retains the form choices. Binder starts in Binder; Custom starts in List. The existing collection selector labels the storage kind. A saved per-device view, explicit Binder/List selection or legacy page/slot/item link still controls presentation. Kind never filters permitted contents or removes grading. Storage/location names stay in the existing owner/linked-partner scope, with no new public projection or sharing opt-in.

All kinds use the existing owner collection allowance and hard safety ceiling. Grid is still null, inheriting the existing owner layout and its entitlement checks. No alternate allowance or legacy create endpoint is used.

## Durable and admission boundary

Only current complete native authority with existing collections/binders can plan creation. First/default creation, mixed legacy storage, conversion and production admission retain their existing restrictions. Pending commands, deletion, raw restore, unresolved recovery and retained legacy work fence confirmation; session/owner changes invalidate handoff. This UI creates no conversion or bootstrap authority.

The immutable draft carries kind/location into `prepareBinderCreation`. The existing operation/collection/slot IDs, original context and copied manifest are retained through IDB aborts, lost replies and reload. The same queue/sender/receipt/fresh complete-read ACK/navigation flow is reused. A collection opens only after current storage and the durable ACK confirm it, and later user navigation wins. Unknown outcomes remain unresolved exact commands. Only original trusted terminal noncommit proof can reach the existing explicit discard flow, retaining the original intent/proof and requiring a new review and new IDs afterward. See [durable copied creation](durable-copied-preset-creation.md) and [terminal proof](creation-import-terminal-noncommit.md).

No queue/store, API handler, backend, schema, SQL, audit event, registry or generated OpenAPI change. Production private/native REST/MCP admission stays denied. No hosted/provider/Framer calls, migration, merge or publication is part of this slice.

## API/help composition

This is UI-only composition of existing staged `list_storage_presets`, `preview_storage_preset` and `create_storage_collection`. Developer base is `https://app.holofolder.com/app/api/v1`; creation is `POST /storage/collections`, MCP tool `create_storage_collection`. The existing create schema already supports `kind: "custom"`, `defaultPresentation: "list"`, `location: "Synthetic shelf"` or null, grid and the copied manifest. Caller-retained IDs and current authorized native planning evidence remain required; preview entry IDs and public/redacted reads are not command authority. The current fixed staged error remains truthful. No external registry alteration is needed.

User help is in `content/docs/native-storage.mdx`; composition guidance is in `content/docs/preset-previews.mdx`; coverage is in `docs/public-api/coverage.md`. [Unpublished release preparation](releases/custom-storage-creation-draft.md) belongs to the eventual enabled #384/#379 block. Issues remain open; the parent owns full acceptance, current-head review, hosted enablement and publication.

## Integration and proof limits

Minimal shared-host edits rename the native entry, add the existing retained-legacy guard, label collection kinds and apply fresh acknowledged default presentation. Inventory occupied actions are unchanged; dependent tests only update native creation control names. Existing legacy picker creation, IDs, URLs and offline keys remain compatible. Further management/Inventory integration and full #384 acceptance belong to the parent, not this PR.

Local production-mode six-phone cases use synthetic authentication/RPC and real BinderApp, overlays, HTTP, IndexedDB and complete reads. They do not establish hosted SQL/RLS, actual PWA installation, physical keyboards/gestures, provider behavior or enabled production creation. No new motion is introduced. Layout and exact verification results are recorded in the PR.

### Measured phone layout

Before this change the native creation UI had no Custom choice or private location review. With the new maximum-length synthetic name (40 characters) and location (200), the confirmation is 486 px high at 375/390 widths and 466 px at 430. Its primary button is 44 px high and remains visible without scrolling the confirmation. Browser and standalone results:

| Width | Sheet height | Browser sheet bottom / dock top | Standalone sheet bottom / dock top |
| ----- | ------------ | ------------------------------- | ---------------------------------- |
| 375   | 486          | 605 / 605                       | 579 / 579                          |
| 390   | 486          | 782 / 782                       | 756 / 756                          |
| 430   | 466          | 870 / 870                       | 844 / 844                          |

Standalone uses the synthetic 59 px top and 34 px bottom insets. All six maximum-text cases pass tap-target, safe-viewport, hittability and horizontal-overflow checks. These are automated Chromium geometry measurements, not physical-device keyboard or installed-PWA evidence.

### Submitted local verification

Pinned Bun 1.3.14: 75 focused unit/docs cases across 11 files pass. The affected production-mode matrix passes 258 cases across all six profiles (192 creation, 12 Custom scope/legacy, 36 navigation and 18 named Inventory/Backup/raw-restore regressions), with no retries. Six additional maximum-text geometry cases pass with no flakes. Typecheck, production harness build/docs CSS and full lint pass; lint keeps the existing 55-warning cap and changed-module lint has zero warnings. Final help wording was checked again with eight docs/composition cases. Initial regression tests failed before implementation; the synthetic executor and partner billing fixtures were corrected to match existing state/owner contracts before the passing matrix.

Matrix selection: `E2E_PORT=3484 bun run test:e2e:matrix e2e/binder-creation.e2e.ts e2e/custom-storage-scope.e2e.ts e2e/collection-views.e2e.ts e2e/native-backup.e2e.ts e2e/inventory-ownership.e2e.ts e2e/raw-restore.e2e.ts --grep 'binder-creation.e2e|custom-storage-scope.e2e|collection-views.e2e|pending native creation|pending creation fences|lost committed reply' --workers=2 --max-failures=1`, with synthetic Supabase configuration. This is an affected subset, not the full e2e suite.
