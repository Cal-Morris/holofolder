# App Marketing Style Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carry the approved marketing site's visual language throughout Holo Folder.

**Architecture:** Update existing global semantic tokens and shared controls, then align component-specific chrome without changing navigation or collection behavior. Fonts remain locally served through next/font and available to the offline shell.

**Tech Stack:** Next.js 16.4, React 19.3, Tailwind, Bun, Playwright.

**Spec:** docs/superpowers/specs/2026-11-07-marketing-style-and-named-shares-design.md

## Global Constraints

- Near-black #07070a, raised surface #111116, off-white #f4f3f8, lavender #b9a6ff, mint #b8ffcf and restrained cyan #7fe7ff.
- Inter body/headings, JetBrains Mono occasional numeric labels. Locally served and offline available.
- Preserve light mode, saved choices, binder customization, image/finish effects and semantic pricing/status colors.
- Keep overlays, tap targets, safe areas, dock positioning and existing navigation behavior.
- Separate this visual release from named sharing. No new dependencies.
- Cal approved execution, use native inline implementation and the repository's standing release authorization.

## Review Focus

- Hardcoded component colors can override shared tokens; audit all primary/dynamic views and both themes.
- Font metrics can overflow phone controls; test long binder names at 375 px.
- New fonts must still render after an offline reload, with no remote font request.
- Body, standalone theme color, skeletons and sheets must paint matching surfaces without first-paint flashes.
- Binder art and price/confidence/status meaning must survive the palette change.

### Task 1: Shared theme and typography

**Files:** Modify app/globals.css, app/layout.tsx, components/ui/button.tsx, components/ui/input.tsx, components/ui/switch.tsx, public/manifest.webmanifest, components/auth/login.module.css, any existing theme-color update helper discovered by rg. Add e2e/app-brand-theme.e2e.ts.

**Interfaces:** Existing --background/--foreground/--card/--primary/--muted/--accent/--border/--ring/--font-sans/--font-mono remain semantic inputs to every screen; no new component API.

- [ ] Add browser assertions for the approved dark background, Inter font, lavender focus/action styling, readable light theme, and long header name/no overflow. Use Harness, not real accounts.
- [ ] Run the new spec on browser-375x667 and confirm it fails on the old theme.
- [ ] Read installed Next font docs and Context7's current font docs. Replace Geist with Inter and JetBrains Mono, retain Latin preload and existing offline font discovery. Apply shared tokens with appropriate accessible light equivalents. Set controls to pill/rounded styling without changing their sizes or semantics. Align browser/installed theme colors and existing login theme.
- [ ] Run targeted spec, unit suite, typecheck and lint. Measure first-load font/JS output against baseline.
- [ ] Commit the coherent shared-theme change, with the spec and this plan.

### Task 2: App-wide component alignment and mobile proof

**Files:** Modify components/binder/app-header.tsx, components/binder/main-content.tsx, components/binder/search-overlay.tsx, components/binder/selected-pokemon-quick-panel.tsx, components/binder-app.tsx (dock), components/settings-modal.tsx, components/binder-switcher-sheet.tsx, components/quick-mode.tsx, components/partner-modal.tsx, components/binder-skeleton.tsx, components/binder-designer/studio.css and remaining view-specific overrides only where inconsistent. Extend e2e/app-brand-theme.e2e.ts and reuse existing overlay/offline/layout tests.

**Interfaces:** Consume Task 1 semantic tokens. Preserve all props/handlers and data structures.

- [ ] Capture baseline geometry/screenshots using Playwright in an owned production server and identify component overrides that visibly fight the shared theme. Avoid broad regex rewrites of all colors or radii.
- [ ] Extend assertions across Binder, List, Wanted, Browse, Analytics, Search, Settings and Quick mode, checking no horizontal overflow and dock/safe-area clearance in dark/light modes.
- [ ] Align header/dock selection, panel hierarchy, spacing, typography and action treatments. Review settings/auth/partner, card detail/selection, Show mode, all loading/error/empty states and Studio controls. Keep the card/binder as the visual focus.
- [ ] Test font loading and offline shell rendering with the real worker; preserve stable storage/cache identifiers. Existing per-user HTML cache exclusions remain.
- [ ] Run bun run test, bun run typecheck, bun run lint, bun run build and all six Playwright projects with --workers=2 on an owned port. Inspect saved screenshots with view_image and record before/after measurements.
- [ ] Obtain one fresh-context whole-branch review, fix substantive findings, and rerun affected checks.
- [ ] Commit, push once, create/link PR, check exact-head Vercel and reviews, merge under release-and-deploy guidance, and verify production. If gates await remote state, watch PR and hand back as required by T3.

## Execution record

Track actual checks, decisions and task completion in this plan's ignored executing-plans ledger. Do not treat source tests as visual or production proof.
