# Bounded bulk fill (#370, #369, #383)

Private browser-host composition only. Production/native cached startup, first-party
inventory/slot routes and public native mutation admission remain denied/read-only.
No migration, grants, conversion, acquisition or hosted write is added. #370/#369
remain open. Parent owns recovery/grading integration, final acceptance and release.

## Actual UI boundary

The admitted `BrowserCollectionSession` supplies the existing complete read, catalog,
queue sink and HTTP sender to BinderApp. Its layout toolbar now binds the existing
bulk page/selection controls. **Edit layout → Select several pockets → select saved pockets → Fill selected
pockets** opens the shared overlay review. Browse taps and page gestures do not fill.
Use **Back to single slot** to return to the grid without the expanded controls.
The toolbar supplies previous/next selection-page buttons without a long drag.
Page selection follows the saved arrangement, never click order or implicit padding.
A copied preset entry whose original target is null identifies an explicit spacer;
it cannot receive a fill. Ordinary free pockets have no catalog constraint and need
an explicit actual-copy choice. No new persistent slot classification is invented.

Manual review shows every selected stable destination ID, saved position, target,
occupied copy, chosen actual inventory ID, recorded printing/language/finish and
whether the copy is already assigned. Mismatches, duplicates, unresolved catalog
identity and occupied destinations block confirmation. Explicit **Skip** preserves a
pocket. A batch cannot silently overwrite, displace or move an assigned copy.

**Preview automatic matches** is opt-in. It proposes only already recorded,
Unassigned copies compatible with empty selected targets using
`inventoryItemCandidate`/`matchesSlotTarget`, including recorded language/finish.
Copy IDs are considered deterministically and used once. Each proposal remains
visible and editable before confirmation. Occupied/spacer/unmatched targets are
visibly skipped. Free pockets remain unresolved until explicitly chosen or skipped.
No printing, target, acquisition, grade or new Raw copy is inferred.

The review freezes its snapshot. Changed evidence requires closing and choosing a
fresh selection, never silently substituting new versions or another duplicate.
Cancel, mismatch review and empty/all-skipped selection cause no mutation. The
sheet uses the shared overlay/back/focus/scroll/swipe behavior; dock navigation,
Done/view/account/owner teardown and offline evidence downgrade clear review only.

## Atomic command, acceptance and recovery

`prepareBulkFillIntent` composes **one** existing inventory request containing
`assign` commands with `selection.kind=existing`, `occupied=cancel`, `fulfillWant=null`.
It preserves target/want/grade/acquisition records and all owned-copy identities.
Existing parsers and canonical projection validate inventory/collection/layout,
slot/item versions and placement absence. No new server operation/planner, queue,
transport or audit recorder is introduced. Server locks and audit context remain
those of the existing `execute_inventory_commands`/storage bridge transaction.

The 100-command, 256-work and 262,144-byte bounds apply before handoff. Oversized
intent is refused with smaller-selection guidance, never chunked or partially
accepted. Original operation/time/context, selected copy IDs and destination
preconditions are fixed before the first durable handoff. An IDB transaction abort
retains that exact draft for **Retry same fill**. The UI requires the real Promise
receipt, so a React-only callback cannot claim device acceptance.

The existing queue commits the complete envelope before device acceptance and
sends it through `sendStorageCommand`. Pending work survives closure/reload,
lost replies and scope teardown. A receipt alone cannot ACK: the session requires
a separate fresh all-stream complete read. Unknown outcomes retain exact retry,
with no cancellation/rebase/new ID. Authoritative terminal rejection uses the
existing fresh-read reconciliation, never a new inverse or optimistic Undo.
Unresolved #469 recovery blocks enqueue in its canonical queue; this lane does not
modify that additive queue field/session binding. Parent must preserve that block
when integrating the shared browser-session edits with recovery and grading props.

## API, proof and rollout limits

This is an app interaction over the existing internal `execute_inventory_commands`
contract. REST/MCP registry, permissions, strict request/error schemas and generated
OpenAPI are unchanged. There is no separate public “bulk fill” data operation or
admission override. Public parity and runtime enablement remain #376/#379 gates.

`e2e/binder-bulk-fill.e2e.ts` runs the real browser host, native IndexedDB commit,
actual HTTP sender/internal handler, terminal-envelope reconciliation and complete
reader. Only the local catalog, identity/membership authority and PostgREST/RPC
ledger are synthetic, labelled in the fixture. This does not prove hosted SQL,
real partner transactions, physical installed PWA/WebKit or a hosted inverse.

Remaining gates include new-catalog-copy fill, arbitrary explicit spacer identity
beyond the existing copied-preset evidence, append-and-assign (parent lane),
grading editor (parent lane), destructive clear/remove and stale-safe Undo,
maximum-workload/real partner evidence, rollout/conversion and production access.
Help: `content/docs/bulk-layout.mdx`. Unpublished copy:
`docs/releases/bulk-slot-fill-draft.md`. No live feature/Framer claim is made.
