---
name: mobile-ui-verification
description: Verify any holofolder UI change on phones at 375, 390 and 430 px widths, in both a browser tab and standalone PWA mode with safe-area insets, covering tap targets, overflow, the dock and sheets. Use before opening any PR that changes UI.
---

# Mobile UI verification

Holo Folder is mobile-first, and most use is in the installed iPhone PWA. Desktop (`sm:` and up) must not regress, but phones come first.

## Checklist

- **Viewports:** 375×667, 390×844 and 430×932. Check each in a browser tab and in standalone mode with insets (59 px top, 34 px bottom).
- **Safe areas:** nothing sits under the status bar or the home indicator. Use `env(safe-area-inset-*)`.
- **Dock:** content and sheets end above the dock and never under it. Position from `--dock-inset`, `--dock-bar` and `--dock-clearance` (`app/globals.css`); don't hard-code offsets. The dock stays visible and hittable over sheets (z-45).
- **Tap targets:** at least 36 px for buttons and controls, and 32 px for chips and inline pills where space is tight.
- **No horizontal overflow** in any view (Binder, List, Wanted, Sets) or sheet.
- **Primary actions are visible without scrolling** in sheets. On phones, the card detail puts its actions first (`max-sm:order-first`).
- **Text:** no clipped placeholders or headings at 375 px. Inputs are 14 px or larger, with numeric `inputMode` for numbers.
- **Overlays:** follow `adding-an-overlay-or-sheet`.
- **Accessibility:** icon-only buttons have `aria-label`s, and dialogs have names.
- **Lazy content inside sheets** must not shift the layout after opening.
- **Light and dark mode** both work.

## Steps

1. Run a production build on your own port, then check each viewport. Use Playwright or Chrome device emulation; for standalone, use `emulateStandalone` from `e2e/fixtures.ts`.
2. Encode the expectations in e2e (`e2e/mobile-layout.e2e.ts`, `dock.e2e.ts`, `detail-sheet.e2e.ts` and `overlays.e2e.ts` patterns) with `expectMinTapTarget`, `expectWithinSafeViewport`, `expectHittable` and `expectNoHorizontalOverflow`.
3. For layout changes, include before and after measurements (px or % of screen) in the PR. Screenshots help.
4. Run only the specs or named tests covering the changed UI across all 6 projects, e.g. `E2E_PORT=<port> bun run test:e2e e2e/mobile-layout.e2e.ts`. Run the full e2e suite only when Cal explicitly asks.
