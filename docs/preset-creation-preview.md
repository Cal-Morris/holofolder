# Preset creation and current-target progress, staged

Related: #367, #368. Public enablement remains #379. This document records the original UI draft slice. The subsequent [durable native creation consumer](durable-copied-preset-creation.md) now connects that draft to the atomic queue and trusted bridge, with production admission still denied.

## What is implemented

`BinderCreationPresets` offers Blank, National Dex, generation, selected species and selected catalog printings. The switcher's optional `stagedCreation` prop replaces only its creation form; production callers omit it. Existing binder names, order, creation API, caps and plan checks stay authoritative. No new page-size setting or entitlement bypass is introduced.

Species selections copy an ordered target list. Generation boundaries use the app's existing generation definitions, with species from the bundled catalog. Printing search uses the existing catalog hook and offline index. Set and language evidence is displayed; unknown language/set evidence cannot create a printing target. Results are a partial search list, never an assertion that all anniversary cards are known. Select the actual printings individually. Language is constrained explicitly; finish remains unconstrained unless a future selector supplies real evidence. Changing the search/filter does not change selected targets. Selecting the same printing twice produces two requirements. Saved manifests never subscribe to later catalog additions.

The 16-row preview pages are presentation only. Blank has zero persisted entries, no implicit free slots. Targets create no inventory, grade or explicit wanted entries. Arrangements are freely editable later, not permanent binder types.

`getBinderGoalPresentation` calls the existing `getBinderCompletion` matcher. It resolves only owner items with a primary placement in the current binder. Missing catalog evidence stays unknown, while incompatible items do not fulfill a target. It distinguishes current target count, assigned copies, filled/free slots, distinct species-target statistics and owner-wide inventory counts, including Unassigned once. Removed/retargeted targets change the current denominator; copied preset provenance is never a second denominator. Zero targets show “No targets yet”, without a percentage. This component is supplied explicit slot/inventory evidence only; it is not injected into legacy bootstrap.

## Private draft adapter, not an executor

`stagedCreation: { ownerUserId, onDraft }` receives `BinderCreationDraft`, parsed by `parseBinderCreationDraft`. Version 1 includes only `operationId`, owner scope, normalized name and a detached recursively frozen copied manifest. The callback is synchronous and signals only draft handoff. The UI explicitly says no binder was saved. Each Prepare action prepares a new intent; it does not retry or send an earlier draft. No mutable store, queue, ACK, audit event or fake success is added.

The [083 backend slice](atomic-storage-creation.md) now provides the internal atomic command/receipt/SQL transaction, still blocked on native creation recovery and #379. The subsequent native consumer is wired as described above; the original standalone preview harness remains draft-only. The backend lane must adapt this draft at the canonical authenticated shared operation boundary, not call legacy `create_binder` and then issue slot updates. That sequence could expose a half-created binder. Before enabling:

- Agree/parse the real versioned creation command. Validate current owner/partner membership and entitlement/cap admission on the server; never trust draft owner attribution.
- Atomically create the named collection, slots and detached manifest with stable server-accepted IDs. Blank accepts zero slots. Preserve existing ordering and custom-grid entitlement rules.
- Carry the original operation/idempotency identity and expected owner inventory/collection-list versions required by the authoritative executor. The UI draft intentionally does not guess missing current versions or declare a new transport contract.
- Replaying the exact same accepted command must return the same binder/result; the same key with different content must conflict. Retain the exact accepted payload across retries. A fresh UI draft is not a retry guarantee.
- Publish REST/MCP schemas/docs only with supported authoritative execution. The staged #376 discovery/preview contract now exposes the supported copied subset behind fixed 503 admission, without durable set scope; the backend command/recovery lane owns execution and migration 083, built on trusted bridge 082.
- Complete #363/#413 offline persistence/replay/fresh-read acknowledgement and #379 compatibility gates, including old clients, partners, export/restore, caps, default binder and rollback. Offline UI here allows preview only and disables Prepare. Uncached printings explicitly require a connection.
- Record actual transactional actor/audit/recovery acceptance. Preparing a draft is not a successful mutation and emits no event.

The isolated `/app/e2e-harness/presets` route requires `HOLOFOLDER_E2E=1`, otherwise 404. Its synthetic local projection demonstrates interaction/progress only, not durable save or execution. Its edit buttons and demo/worst-case toggle are test scaffolding, not the parallel layout lane's product integration.

## Remaining issue acceptance

#367 stays open for canonical runtime consumers, owner/partner integration and enabled/deployed evidence. #368 stays open for atomic/idempotent creation, offline outcomes, editing integration and rollout. #369 owns actual layout editing. #379 still gates production exposure. No migration, hosted write, grant, conversion, merge or Framer publication is part of this slice.

The enabled-release copy is an [unpublished draft](releases/preset-creation-draft.md). Publish only after the parent verifies production enablement and actual API/help/audit/offline evidence.

## Verification for this slice

Focused unit verification covers copied manifests, detached immutable drafts, actual-primary-placement completion, free Energy pages alongside the 1,025-target Dex, removed/retargeted requirements, repeated printings, zero targets and existing inventory/offline/illustrator contracts. The six-phone `binder-presets` matrix covers Blank/Kanto, selected species and printings, ordered pages, long labels, unknown catalog language, caps, keyboard submit/focus return, dock clearance and shared X/Escape/back/backdrop/swipe/tab dismissal. No physical-device keyboard/gesture claim is made.

Craft review:

| Before                                                        | After                                                                                     | Why                                                     |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Raw catalog form suffix such as `maushold-family-of-four`     | Existing display-name formatter shows Maushold                                            | Keep canonical species IDs while showing familiar names |
| Staged creation would inherit the legacy full-height switcher | Staged-only dock clearance and dynamic viewport cap                                       | Keep the sheet above the dock and safe areas            |
| Catalog evidence can be absent                                | Disable printing selection with missing set/language evidence and explain cached coverage | Never guess a printing or imply a complete catalog list |

No new animation is added. Selection and keyboard feedback is immediate; the existing shared sheet gesture handles dismissal. The schema-backed 40-character binder name and plausible long catalog/set labels are exercised without overflow. The synthetic worst-case toggle and all edit scaffolding stay inside the hard-gated harness.

Local evidence on the submitted slice: 94 focused unit tests pass across eight files; 138 affected browser/standalone cases pass across all six phone profiles without retries; typecheck and production build pass; full lint remains at the unchanged 55-warning cap and focused lint has zero warnings. The mobile run includes all existing slot-picker cases plus legacy switcher/create and illustrator search/offline regressions. This is not a full local e2e run or hosted/deployed execution proof.

## Set and variant scope extension

The creation picker and opt-in Sets integration now share [copied set checklist drafts](set-preset-checklists.md). This extends the preset target model with a detached exact catalog/scope envelope alongside the existing 083-compatible manifest. It adds no durable executor or public enablement.
