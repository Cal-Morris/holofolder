---
name: adding-an-overlay-or-sheet
description: Build a modal, bottom sheet, dialog or popover in Holo Folder using the shared overlay primitive (useOverlay and useSwipeToDismiss) so it can be dismissed every way, doesn't stack, and works on phones and in the standalone PWA. Use for any new overlay UI.
---

# Adding an overlay or sheet

Every overlay must use `hooks/use-overlay.ts`. The stack bookkeeping and swipe maths are in `lib/overlay-stack.ts`, which has unit tests. Good references: `components/partner-modal.tsx` (simple modal) and `components/pokemon-cards-browser.tsx` (sheet with swipe).

## New overlays: use `OverlayDialog`

New sheets and modals use `components/ui/overlay-dialog.tsx`. It renders a native `<dialog>` opened with `showModal()` (top layer above the header and dock, inert page behind, native focus restore) and wires `useOverlay` and `useSwipeToDismiss` inside, so every dismissal path below comes for free. Reference: `components/wanted-filters-sheet.tsx`.

```tsx
<OverlayDialog
  onClose={onClose}
  aria-label="Sort and filter want list"
  className="flex flex-col px-4 pt-3 pb-[calc(var(--safe-bottom)+0.75rem)]"
>
  <div data-sheet-grabber className="-mx-4 -mt-3 shrink-0 px-4 pt-3">
    {/* grabber pill, title, <button aria-label="Close …" onClick={onClose} className="h-9 w-9 …"> */}
  </div>
  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">…</div>
</OverlayDialog>
```

- Render it while open and unmount it to close. `variant` is `sheet` (default, bottom edge, swipes) or `centred`.
- The `<dialog>` is the panel: pass padding, height and layout in `className` (merged with `cn`, so you can override the sheet chrome, e.g. `bottom-[var(--dock-clearance)]`).
- Name it (`aria-label`/`aria-labelledby`) and render your own X (36 px+) calling `onClose`.
- Mark the swipe header `data-sheet-grabber`; there are no handlers to spread.
- The backdrop is `::backdrop`; a press and click both outside the dialog close it. There is no `data-overlay-backdrop` element (e2e `tapBackdrop` accepts `dialog:modal` hits).
- Escape is still `useOverlay`'s; the dialog's `cancel` event is prevented and only closes for other close requests (Android back through CloseWatcher).
- The page behind is inert, so anything it must show over (menus portalled to `body`) has to live inside the dialog. A div overlay opened from inside one will sit under it.
- Non-modal (`modal={false}`) is for overlays that leave the dock usable: they keep their z-index, with a `data-overlay-backdrop` div (`backdropProps`) and an optional `layerClassName` layer. `layerChildren` renders an inner overlay (a picker opened from the sheet) in that layer but outside the dialog, so it can't drag it.
- `swipe` overrides whether it swipes (e.g. `swipe={!isDesktop}`, or off while saving). `variant="fullscreen"` (modal) covers the screen with a clear `::backdrop` for viewers that draw their own.
- `managed`: a parent's `useOverlay` owns it, with its `containerRef` on the dialog's `ref`, so phases that swap dialogs (a scanner's camera, then its review) keep one history entry.
- Shapes already shared: `OverlayInsetSheet` (inset sheet above the dock, styled by a CSS module through `className`), `CardDetailSheet`, `CardsBrowserSheet` and `ScanSheet`. Reuse one before writing panel classes.
- Toasts (`toast()` from `components/ui/toast.tsx`) handle this themselves: they render inside the topmost modal dialog and sit just above its last visible `[data-toast-anchor]` (spread `TOAST_ANCHOR`). `OverlayFooter` is already an anchor; mark any other sticky bottom action area that covers the dock (Show's deal check and bundle footers do), or the toast lands on it.

The steps below describe the older div overlays, still in use until they are migrated.

## Steps

1. **Markup.** A fixed container with:
   - a backdrop: `<div data-overlay-backdrop onClick={onClose} … />`
   - a panel: `ref={dialogRef} role="dialog" aria-modal="true" aria-label="…"` (an accessible name is required)
   - a close button with `aria-label="Close …"` and at least 36×36 px (`h-9 w-9` or larger)
2. **Wire the primitive:**

   ```tsx
   useOverlay(isOpen, onClose, { containerRef: dialogRef });
   ```

   This gives you:
   - Escape closes the topmost overlay only
   - a history entry, so browser or Android back closes it instead of leaving the page
   - a focus trap, with focus returned to the opener
   - a ref-counted body scroll lock

   Options: `autoFocus: false` (e.g. when a search input should focus itself), `history`, `trapFocus`, `lockScroll`.

3. **Bottom sheets on phones:** `const swipe = useSwipeToDismiss(sheetRef, onClose, enabled)`. Spread the handlers on the grabber or header (mark it `data-sheet-grabber`) and show a grabber pill on phones. Buttons and inputs, and anything marked `data-no-swipe`, never start a swipe from the header. On touch screens the hook also drags the sheet when the body is pulled down while scrolled to the top; once the body is scrolled, it scrolls. A modal centred with a Tailwind translate on wider screens doesn't drag.
4. **Layout:**
   - Respect the safe areas: `env(safe-area-inset-top)` and the dock variables `--dock-inset`, `--dock-bar` and `--dock-clearance` from `app/globals.css`.
   - Keep the header (grabber, title, X) `shrink-0` and sticky, so only the body scrolls (`overflow-y-auto overscroll-contain`).
   - Cap the height so the X is always on screen.
5. **No stacking.**
   - Opening a dock-launched overlay replaces any open one.
   - A dock tab switch calls `closeAllOverlays()`. Make sure your open state is cleared there if you own it in `binder-app.tsx`.
   - Only deliberate one-level stacks are allowed (e.g. the card selector over the card detail, or All cards over the detail). Closing the top one returns to exactly the one below.
   - To navigate from an overlay (e.g. the binder switcher), close it first and navigate with `runAfterOverlayHistory` from an effect, so popping the overlay's history entry can't undo the navigation.
6. **Lazy-load** big or rarely opened overlays with `next/dynamic(…, { ssr: false })`. Don't lazy-load content that renders inside an already open sheet (it shifts the layout). SSR-kept dynamics need a `loading` option.
7. **Tests.** Add the overlay to the `e2e/overlays.e2e.ts` patterns:
   - the close control is within the safe viewport and hittable, and is at least 36 px
   - X closes it and restores focus
   - Escape, back (staying on the page) and the backdrop close it
   - swipe closes it (sheets only)
   - scroll is unlocked afterwards
   - a tab switch closes it

   Then run only the affected overlay tests across all 6 projects, e.g. `E2E_PORT=<port> bun run test:e2e:matrix e2e/overlays.e2e.ts --grep "<overlay name>"`, and see `mobile-ui-verification`. Run the full e2e suite only when Cal explicitly asks.
