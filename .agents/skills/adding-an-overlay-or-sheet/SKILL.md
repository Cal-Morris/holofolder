---
name: adding-an-overlay-or-sheet
description: Build a modal, bottom sheet, dialog or popover in Holo Folder using the shared overlay primitive (useOverlay and useSwipeToDismiss) so it can be dismissed every way, doesn't stack, and works on phones and in the standalone PWA. Use for any new overlay UI.
---

# Adding an overlay or sheet

Every overlay must use `hooks/use-overlay.ts`. The stack bookkeeping and swipe maths are in `lib/overlay-stack.ts`, which has unit tests. Good references: `components/partner-modal.tsx` (simple modal) and `components/pokemon-cards-browser.tsx` (sheet with swipe).

## Steps

1. **Markup.** A fixed container with:
   - a backdrop: `<div data-overlay-backdrop onClick={onClose} … />`
   - a panel: `ref={dialogRef} role="dialog" aria-modal="true" aria-label="…"` (an accessible name is required)
   - a close button with `aria-label="Close …"` and at least 36×36 px (`h-9 w-9` or larger)
2. **Wire the primitive:**
   ```tsx
   useOverlay(isOpen, onClose, { containerRef: dialogRef })
   ```
   This gives you:
   - Escape closes the topmost overlay only
   - a history entry, so browser or Android back closes it instead of leaving the page
   - a focus trap, with focus returned to the opener
   - a ref-counted body scroll lock

   Options: `autoFocus: false` (e.g. when a search input should focus itself), `history`, `trapFocus`, `lockScroll`.
3. **Bottom sheets on phones:** `const swipe = useSwipeToDismiss(sheetRef, onClose, enabled)`. Spread the handlers on the grabber or header. Buttons and inputs, and anything marked `data-no-swipe`, never start a swipe.
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

   Then run `bun run test:e2e` across all 6 projects, and see `mobile-ui-verification`.
