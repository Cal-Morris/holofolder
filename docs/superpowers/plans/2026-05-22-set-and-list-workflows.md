# Set And List Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make BinderDex easy to manage from both set coverage and fast list workflows, while keeping the binder as the premium visual surface.

**Architecture:** Use the existing mirrored TCGdex tables as the source of truth for set-to-Pokedex mapping. Add a route-backed set coverage API, then layer two client views on top of the existing collection actions: List for fast ownership management, Sets for set-driven dex slot population.

**Tech Stack:** Next.js App Router, React 19, Supabase mirror tables, Tailwind utility UI, existing `useCollection` and `useCardPrices` hooks.

---

### Task 1: Set Coverage API

**Files:**
- Create: `lib/tcg-set-slots.ts`
- Modify: `lib/tcg-mirror.ts`
- Create: `app/api/tcg-set-slots/route.ts`

- [x] Add shared response types for set summaries, set cards, and dex slots.
- [x] Add `searchMirroredSets(query)` to query `tcg_sets` by name or id.
- [x] Add `getMirroredSetDexSlots(setId)` to return only cards linked through `tcg_card_dex_ids`.
- [x] Infer a sensible default card finish from rarity and variants.
- [x] Add `/api/tcg-set-slots` with `query`, `setId`, and `language` support.
- [x] Verify with `curl /api/tcg-set-slots?setId=sv03.5`.

### Task 2: List Management View

**Files:**
- Create: `components/dex-list-view.tsx`
- Modify: `components/binder-app.tsx`

- [x] Add an app-level view state: `binder`, `list`, `sets`.
- [x] Add a mobile and desktop List entry point.
- [x] Render filtered dex slots as dense rows with card art, status, wanted count, and price.
- [x] Wire row actions into existing `addToCollection`, `removeFromCollection`, `CardSelector`, and favorite status.
- [x] Add bulk actions for set-selected rows after the first slice is stable.

### Task 3: Set Population View

**Files:**
- Create: `components/set-population-view.tsx`
- Modify: `components/binder-app.tsx`

- [x] Add a premium set search surface with horizontal set choices.
- [x] Show set summary counts: dex slots, owned, missing, wanted.
- [x] Render every Pokedex slot the selected set can populate.
- [x] Let users add the primary set card directly as owned or wanted.
- [x] Add alternate-card chooser inside the set row when multiple cards in a set map to the same dex slot.

### Task 4: UX Pass

**Files:**
- Modify: `components/binder-app.tsx`
- Modify: `components/dex-list-view.tsx`
- Modify: `components/set-population-view.tsx`

- [x] Keep navigation app-like on iOS: bottom segmented nav has Binder, List, Sets.
- [x] Keep the binder view visually framed and leave list/set views as full-height tool surfaces.
- [x] Keep selected-card variant changes inline so finish updates do not require re-selecting the card.
- [x] Keep page navigation arrow-only and disabled at the start/end of the binder.
- [x] Let mobile gyro drive card finish glints even when binder slot glare is disabled.
- [x] Add persistent view-specific search/filter chips after user testing the first slice.
- [x] Add empty-state shortcuts for common sets once the API shape is proven in production.

### Task 5: Verification And Release

**Files:**
- No new files expected.

- [x] Run `bunx tsc --noEmit`.
- [x] Run `bun run build`.
- [x] Verify `/api/tcg-set-slots?setId=sv03.5` returns 151 dex slots.
- [x] Smoke test the List and Sets views in a browser screenshot.
- [x] Simulate `deviceorientation` and verify the glint CSS position updates.
- [x] Commit, push to `main`, and verify the Vercel production bundle.
