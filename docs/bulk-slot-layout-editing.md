# Private bulk layout slice (#370, #369)

This extends the existing internal layout editor after durable local acceptance (#427) and atomic creation (#428). Production remains legacy-authoritative; app/REST/MCP slot routes stay gated. No hosted reads/writes, migrations, grants, conversion, supported public operation, OpenAPI change or rollout enablement is added. #370 and #369 remain open.

## Host integration

`LayoutToolbar` in `components/binder/layout-editor.tsx` accepts optional `bulk: BulkLayoutHost` alongside its existing `editing`, `onToggle` and `boundary` props:

```tsx
<LayoutToolbar editing={editing} onToggle={toggleEditing} boundary={boundary}
  bulk={{ pageIndex, rows, cols, sessionKey }} />
```

`pageIndex` is zero-based in the **complete saved arrangement**, never a filtered view. Rows/columns are integers 1–8. `sessionKey` identifies the deliberate edit/session lifetime. The supplied `boundary.snapshot` must be the current complete optimistic inventory snapshot for the matching owner/collection, with its real catalog resolver and existing `SlotCommandSink`. Do not manufacture a local receipt or use a callback that only updates React state to claim persistence. The actual queue adapter's Promise resolves to `saved-on-device` only after the IndexedDB transaction commits; refresh failures after commit remain accepted. Synchronous draft-only callbacks retain their existing semantics and never produce a saved message.

The host owns Browse/Edit and page/view/scope controls. Only offer this toolbar with an authorized complete private boundary and unfiltered binder presentation. Unmount it on leaving the binder view, presentation filtering, read-only/share changes or any identity/session change, including relinking to the same owner. Change `sessionKey` on those session boundaries and set editing false. Done sets editing false. Owner/collection/session/dimension changes key the bulk editor, clearing transient selection and unfinished destination. Page changes preserve selection. Never persist edit mode or selection. No accepted operation is revoked on unmount. The #386 integration worker owns BinderApp/main-content/header/dock/navigation; this PR supplies the prop contract without editing those files. Existing callers without `bulk` retain the single-slot editor.

Bulk selection lives in this editor's labelled saved-slot controls; it is separate from the host's card-detail selection. Do not bind normal browse grid taps to bulk actions or show single-slot editing as the group action. The inline panel has a bounded scroll region and sticky selection count, keeping Done and host paging outside it. No new overlay or animation is introduced. There is no long press or drag handler. Buttons require a pointer beginning on the mounted control and reject cancellation or movement beyond eight pixels; native keyboard activation works. The select-page control remounts on page changes, so a gesture begun on another page cannot select the new page.

## Operations and limits

- Select individual stable slot IDs across pages, select the current page, or clear selection. Visible count includes all selected pages. Select page includes only stored slots, never implicit padding. Adding a page that would exceed 256 selected slots rejects the entire selection change.
- Move the group before/after an unselected destination, to beginning, or to end. Noncontiguous slots move in **saved relative order**, independent of click order. A selected destination explicitly rejects and its move buttons are disabled. After-anchor resolution skips selected successors before forming `beforeSlotId`.
- Insert N (1–256) free stored slots before/after an exact saved anchor, append N, or insert one current rows×columns page before/after an anchor. Existing slots shift across page boundaries. Insertion never searches empty pockets or overwrites cards. Grid changes only repaginate the ordered slots; an inserted page is not pinned to a boundary.
- Each group produces **one** existing parsed `slots.move` or `slots.create` command in **one** request/operation ID. It retains inventory/collection/layout revisions, selected slot/item/placement predicates and the original operation context. Existing 256 affected/inserted, 4,096 capacity and transport byte limits apply. Oversized groups reject before handoff; no separately accepted chunks.

Targets, wants, preset origin, slot IDs, item IDs and placements travel unchanged in moves. No owned item is created, removed or reassigned by these commands. The pure helper uses the canonical parser/projection, not an alternative persistence or transaction model. Receipt means **Saved on device · Pending sync**, never server/audit success. Existing remote transaction/replay/actor attribution contracts remain authoritative.

## Stale evidence and failures

Selection captures each complete slot, owned item and placement as evidence, plus inventory, collection and layout revisions. If revisions change but every selected slot/copy is unchanged, all execution is blocked until **Use latest layout** explicitly refreshes revision evidence after reviewing the current order. Stable selected IDs remain selected. If any selected target/want/copy/version/placement changes or disappears, the entire group blocks. No missing subset is silently dropped and no replacement copy becomes selected. Clear selection and explicitly choose again after review.

A rejected local handoff retains the exact original operation, IDs, revisions and complete group for **Retry same group**. It blocks further selection/mutations. **Discard unaccepted draft** discards only that rejected editor attempt and retains selection evidence, allowing latest-layout review. It never cancels previously accepted queue work. A stale request is not automatically rebuilt with fresh predicates. Queue reconciliation blocks remain visible in the owning session and cannot be bypassed by this toolbar. Done may unmount during commit; a transaction that subsequently commits remains in the queue.

## Verification boundary and remaining gates

`/app/e2e-harness/bulk-layout` requires `HOLOFOLDER_E2E=1`, otherwise 404. It uses synthetic identity/catalog/partner/read streams and the real shared queue, complete-reader validation, projection and IndexedDB transactions. It does not execute authenticated server writes. The dedicated spec checks the six phone profiles, group acceptance/retry, reload/offline retention, selected-copy conflicts and synthetic fresh complete ACK. Existing slot editor regression coverage runs separately. Emulated Chromium standalone is not physical iOS/WebKit proof.

Remaining #370/#369 acceptance: ordered catalog fill and mismatch/replacement previews; authoritative Undo with stale partner/assignment protection; bulk clear/remove consequence previews plus atomic undo; cross-storage operations (#383); actual authenticated execution, partner reconciliation UX and production startup/bootstrap/conversion/API grants and enablement. Existing atomic clear/remove contracts retain owned items as Unassigned, but exposing destructive execution before Undo/recovery is ready would not meet the feature contract, so this slice does not expose it. No synthetic fill, Undo, remote save or shipped customer capability is claimed. Recovery files and their independently owned contracts are untouched.

API coverage: this is a private UI/device consumer of the already parsed internal slot command and acceptance boundary. No supported public REST/MCP capability or generated OpenAPI change applies until #376/#379 enable the feature with authentication, permissions/errors, audit/recovery and documentation parity. Staged user help is `content/docs/bulk-layout.mdx`. Enabled-release copy is prepared, unpublished, in `docs/releases/bulk-slot-layout-draft.md`; public Framer help/blog/changelog publication waits for the enabled feature block (#393).
