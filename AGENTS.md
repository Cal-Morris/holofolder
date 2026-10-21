# AGENTS.md

This is the canonical guide for AI coding agents (and humans) working on **binderdex**. `CLAUDE.md`, `.cursor/rules/` and `.github/copilot-instructions.md` all point here. Task-specific playbooks are in [`.agents/skills/`](.agents/skills/) (one folder per skill, each with a `SKILL.md`).

## What this is

binderdex is a mobile-first Pokémon binder tracker, live at https://binder.cal.gg. It covers:
- National Dex binder pages
- collection and wanted lists
- card matching and camera scanning
- partner (shared) collections and read-only share links
- card prices with confidence-gated signals
- an installable PWA that works offline

Stack:
- **Next.js 16** (App Router, Turbopack, `cacheComponents`)
- **React 19** and **TypeScript 6**
- **Bun**
- **Tailwind**, with shadcn primitives in `components/ui/`
- **Supabase** (auth, Postgres, Realtime)
- **Vercel** (hosting, Workflows, cron), with a **Cloudflare R2** card image mirror

## Architecture map

| Path | What lives there |
|---|---|
| `app/` | Routes and API handlers. `page.tsx` is the binder (server bootstrap via `lib/server/`), plus `home/`, `auth/`, `share/` (read-only binders) and `app-shell/` (static offline shell). `e2e-harness/` is served only when `BINDERDEX_E2E=1`. |
| `app/api/` | `collection`, `settings`, `binder-share`, `card-prices` (+ `refresh` for the cron and on-demand workflow), `tcgdex-cache`, `tcg-set-slots`, `tcg-card-search`, `card-image-proxy`, and `admin/{sync-card-db,mirror-card-images}`. |
| `proxy.ts` | Next 16 request proxy (formerly middleware). It refreshes the Supabase session. |
| `components/` | `binder-app.tsx` is the main client app (binder, list, wanted and sets views, dock, card detail sheet). Modals and secondary views (`settings-modal`, `auth-modal`, `partner-modal`, `card-selector`, `pokemon-cards-browser`, `dex-list-view`, `set-population-view`) are `next/dynamic` imports. |
| `hooks/` | `use-collection` (sync boundary: optimistic edits, offline queue, realtime and polling), `use-settings`, `use-card-prices`, `use-overlay` (the shared overlay primitive), `use-tcgdex`, `use-partner`, `use-offline-store-sync`, `use-collapse-on-scroll`, `use-touch-gestures`. |
| `lib/domain/` | Shared card domain types and normalizers: `CARD_LANGUAGES`, `CARD_FINISHES`, `SLOT_STATUSES`, `WantedCard`, `CollectedPokemon`, `TCGCard`. |
| `lib/collection/` | Pure collection logic: `normalize`, `offline-queue` (localStorage snapshot and pending ops), `remote` (reads and writes), `refresh-policy` (poll intervals), `sync` (conflict-safe offline write sync: fingerprints, three-way merge, backoff). |
| `lib/settings.ts` | Binder settings defaults and `user_settings` row mapping (single source). |
| `lib/server/` | Server data layer: `collection-owner` (partner owner resolution) and `binder-bootstrap`. |
| `lib/card-pricing.ts` | Price provider pipeline and the **single source** of pricing types and normalizers (the client hook re-exports them). Related: `price-intelligence`, `price-freshness`, `price-momentum` (Rising), `breakout-cards`, `price-refresh-interval`. |
| `lib/offline-store/` | IndexedDB store `binderdex-offline` (`kv`, `records`, `collection-mirror`): a collection and wantlist mirror, last-known prices and opened set lookups. |
| `lib/card-image-store.ts` and friends | Image mirror backend selection (`CARD_IMAGE_STORE=r2\|blob\|off`): `card-image-r2.ts` (S3 API via aws4fetch), `card-image-blob.ts` (Vercel Blob), and `card-image-backfill.ts`. See [`docs/card-image-store.md`](docs/card-image-store.md). |
| `lib/card-db-sync*.ts`, `lib/tcg-mirror.ts`, `lib/tcgdex-shared.ts` | TCGdex → Postgres sync (CLI and incremental API), plus cached mirror reads (`"use cache: remote"`, tag `tcg-mirror`). |
| `lib/card-scan-*`, `lib/binder-page-scan*` | Camera card and page scanning (OCR via tesseract.js, image matching). |
| `lib/supabase/` | `client`, `server`, `admin` (service role; server only, never import it statically into client code) and `middleware`. |
| `workflows/card-price-refresh.ts` | Vercel Workflow that refreshes prices in passes (`sleep()` interval validated by `lib/price-refresh-interval.ts`). |
| `scripts/` | Numbered SQL migrations (`NNN_*.sql`, see [`scripts/MIGRATIONS.md`](scripts/MIGRATIONS.md)), `sync-card-db.ts`, `mirror-card-images.ts`, `generate-app-icons.mjs`. |
| `public/sw.js` | Service worker: offline shell, data and image caches, warm-up. |
| `tests/` | Unit tests (`*.test.ts`, written with `node:test` and `node:assert/strict`, run by `bun test`). |
| `e2e/` | Playwright suite (`*.e2e.ts`), with `fixtures.ts` (harness and mocks) and `price-fixtures.ts`. |
| `docs/` | Design notes (`card-image-store.md`; older implementation plans under `docs/superpowers/plans/`). |

## Data flow

1. **Card data (TCGdex mirror).** `bun run sync-card-db` or `POST /api/admin/sync-card-db` loads TCGdex series, sets, cards, dex links and external ids into the Postgres tables `tcg_*` (migration 004). The app reads them through `lib/tcg-mirror.ts`, which uses cached queries tagged `tcg-mirror` and revalidated after a sync. These reads are served via `/api/tcgdex-cache`, `/api/tcg-set-slots` and `/api/tcg-card-search`.
2. **User data (Supabase).**
   - `pokemon_collection` (one row per Pokémon, with `status`, the owned printing and a `wanted_cards` JSONB list), `user_settings`, `partnerships` / `partner_invites` and `binder_shares`, all with RLS.
   - Partners share the owner's collection (`lib/server/collection-owner.ts`).
   - Clients write through `/api/collection` and `/api/settings`. Edits are optimistic and queued in localStorage (`lib/collection/offline-queue.ts`), mirrored to IndexedDB, and flushed when back online, on new edits, and when the app becomes visible.
   - Queued collection writes send a `baseFingerprint`. The API does compare-and-set and answers `409` with the current row on a conflict, and the client does a three-way merge (`lib/collection/sync.ts`).
   - Retries use exponential backoff. A hard 4xx rolls the edit back and tells the user.
   - Other screens refresh via a Supabase Realtime broadcast per owner, with polling as fallback: 5 s, or 60 s while realtime is connected, and paused in hidden tabs.
3. **Pricing.**
   - Providers include TCGplayer, Cardmarket and PokePulse (`PriceProvider` in `lib/price-intelligence.ts`).
   - Results are normalised to GBP with ECB FX rates and stored in `card_prices` with confidence, range, per-source evidence and trend points.
   - The refresh runs through `workflows/card-price-refresh.ts`: daily via cron (`vercel.json` → `GET /api/card-prices/refresh`, `CRON_SECRET`) and on demand (`POST`, signed-in user).
   - The client caches prices in localStorage (`hooks/use-card-prices.ts`).
   - Rising and Breakout signals are computed client-side from trend points, behind confidence gates.
4. **Images.**
   - Card images are only ever served through `/api/card-image-proxy` (same-origin, immutable cache headers).
   - TCGdex card images, and fallback-source images (TCGplayer, pokemontcg.io, Scrydex, Limitless) for cards TCGdex has no image for, are mirrored into R2 (or Blob) under deterministic keys (see `docs/card-image-store.md`). On a miss the proxy serves the origin and uploads afterwards. Blocked or throttled stores are skipped for a cooldown.
   - Pokémon artwork from PokeAPI is resized by the proxy (`&w=` in 96/160/240/320/480).
   - The response header `x-card-image-source` is `r2`, `blob`, `tcgdex` or `upstream`.
5. **Offline.**
   - `public/sw.js` precaches the static `/app-shell` and its assets, and serves it for failed or stalled navigations (not `/auth/*` or `/share/*`).
   - Card data is network-first with a 5 s cache fallback. Images are cache-first, capped at 1,500 entries.
   - The app warms the cache for visible slots.
   - `components/offline-app-shell.tsx` boots the binder from on-device data only.

## Setup

```bash
bun install
cp .env.example .env.local   # fill in the values you need
bun run dev                  # http://localhost:3000
```

- Only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are needed for local dev. `.env.example` documents every variable, and R2 setup is in `docs/card-image-store.md`.
- **Never commit secrets** or `.env*` files, apart from `.env.example`. Never paste tokens into code, tests, PR descriptions or logs.
- Several agents may share one machine. Run your dev or test server on **your own port** (`bun run dev -p <port>`, `E2E_PORT=<port>`), and **never kill processes you didn't start**.

## Commands

| Command | Notes |
|---|---|
| `bun run dev` | Dev server |
| `bun run test` | Unit tests in `tests/` (`bun test tests/`) |
| `bun run test:coverage` | Unit tests with coverage |
| `bun run typecheck` | `tsc --noEmit`; must be clean. `next build` also type-checks. |
| `bun run lint` | ESLint with **`--max-warnings=79`**. This is a ratchet: never add warnings. If you remove some, lower the cap in `package.json`. Prefix intentionally unused vars with `_`. |
| `bun run build` | Production build |
| `bun run test:e2e` | Playwright: builds and serves on port 3210 (`E2E_PORT` to change it, `E2E_BASE_URL` to test a running server) with `BINDERDEX_E2E=1` |
| `bun run test:e2e:install` | Installs Chromium for Playwright (or set `CHROME_PATH`) |
| `bun run sync-card-db [--dry-run]` | Full TCGdex → Postgres sync (needs `POSTGRES_URL_NON_POOLING` or `DATABASE_URL`) |
| `bun run mirror-card-images` | Local, resumable R2 image backfill. Flags: `--set`, `--from`, `--lang`, `--quality`, `--concurrency`, `--max-class-a`, `--max-gb` |

Admin API routes are `POST` only. Authenticate with `Authorization: Bearer <secret>`, where the secret is any of `CARD_DB_SYNC_SECRET`, `SYNC_SECRET` or `CRON_SECRET` (the legacy `x-card-db-sync-secret` header also works). They return 503 when no secret is configured.
- `/api/admin/sync-card-db`: incremental upsert. Modes: `?set=a,b`, `?recent=N`, or the default `missing`. Options: `?maxSets=` (default 4, max 12), `?dryRun=1`, `?images=0`. Repeat until `"done": true`.
- `/api/admin/mirror-card-images`: resumable image backfill. Options: `?cursor=`, `?set=`, `?lang=`, `?quality=`, `?maxSets=`, `?maxUploads=`. Repeat with `nextCursor` until `"done": true`.

## Database migrations

- The schema is the numbered files `scripts/NNN_*.sql`.
- There is **no migration runner**: they are applied **manually** to Supabase (SQL editor or `psql`) in numeric order.
- Files `002`/`003` are not in the repo; `MIGRATIONS.md` reconstructs `user_settings`.
- New migrations use the next free number, must be idempotent (`IF NOT EXISTS`, `DROP … IF EXISTS`) and need a row in [`scripts/MIGRATIONS.md`](scripts/MIGRATIONS.md).
- Say in the PR that the migration must be applied, and make the app tolerate it not being applied yet.
- **Apply migrations as part of shipping database changes.** Cal authorizes applying the task's numbered migrations to the existing hosted Supabase project without a separate confirmation. Inspect the target schema, apply only the required unapplied migrations in numeric order, and verify the resulting schema and data changes. Choose the migration/deployment order to keep the running app compatible. Record what was applied in the PR; don't leave migration application as a follow-up or call the release complete until it is verified. If access is unavailable or a migration fails, report the concrete blocker.
- Don't move or rename `004_create_tcg_mirror_tables.sql`: the sync reads it at runtime.

See the skill [`adding-a-db-migration`](.agents/skills/adding-a-db-migration/SKILL.md).

## Deployment

- **Ship small, scoped changes by default.** Unless Cal explicitly asks for local-only work, completing a small change includes committing it on its own branch, running the required local checks, pushing the branch, opening a PR, and merging once all required checks and reviews pass. Continue through production deployment verification using the `release-and-deploy` skill. This is standing authorization for those steps; don't stop at "fixed locally" or ask for separate permission to commit, push, open the PR or merge. If a gate fails, fix failures within the task's scope or report the concrete blocker. The verified quota exception below still applies.
- Vercel deploys `main` to production. Every PR push gets a preview deployment, and its **Vercel** status check is the default merge gate.
- The project is on the **Hobby plan**, which has a daily deployment limit. Every push, rebase and merge costs a deploy. So:
  - **verify locally first, then push once per PR**
  - don't push "retry" commits
  - only rebase when GitHub says the branch is out of date or conflicting
  - merge one PR at a time
- **Keep merging when Vercel explicitly reports "Deployment rate limited" or an exhausted account build/deployment quota.** Verify the check details, run all required local checks on the current PR head, and require every other required check and review to pass. Record the quota failure and local validation in the PR, then merge without waiting for the reset or pushing retry commits.
- A quota-blocked merge is **merged, deployment pending**. After the limit resets, deploy the latest `main` and verify its production deployment; don't redeploy an older PR head.
- There are no GitHub Actions workflows. Don't add `.github/workflows` unless the owner asks.

See the skill [`release-and-deploy`](.agents/skills/release-and-deploy/SKILL.md).

## Principles

- **Small, focused PRs and commits, one concern each.** Use a separate short-lived branch off the latest `main` for each independent feature or fix wherever possible. Split unrelated work before committing; keep dependent changes together when needed for a working PR. No drive-by refactors. Say what was verified and what wasn't.
- **Merge on a green Vercel check or the verified quota exception above.** Real build failures and other unmet checks or reviews still block merging. Admin merge is allowed only when needed to bypass the quota-only Vercel check after every other requirement passes. Never skip hooks.
- **Mobile-first.** Verify at **375×667, 390×844 and 430×932**, in both a normal browser tab and **standalone PWA** mode with safe-area insets (59 px top, 34 px bottom in the e2e harness).
  - Tap targets are at least 36 px. No horizontal overflow.
  - Nothing goes under the dock: position against `--dock-inset`, `--dock-bar` and `--dock-clearance` in `globals.css`.
- **Every overlay uses the shared primitive** (`useOverlay`, plus `useSwipeToDismiss` for bottom sheets).
  - It must be dismissible by the X button (36 px or larger), a backdrop tap (`data-overlay-backdrop`), Escape, browser or Android back, and swipe-down.
  - It needs `role="dialog"` and an accessible name.
  - It closes on dock tab switch (`closeAllOverlays`). Overlays don't stack, except one deliberate level (e.g. card selector over card detail).
- **Offline-first.**
  - The binder must open and stay usable offline and on dead Wi-Fi.
  - Edits queue and sync later. Never lose a queued edit.
  - Never cache per-user HTML in the service worker.
- **Never invent card or price data.**
  - Unknown means unknown: no guessed FX rates, and zero or negative provider amounts count as missing.
  - Price signals (Rising, Breakout, buy signals) are **confidence-gated**: high or medium only, never on low or unknown confidence.
  - Test fixtures must be clearly labelled as synthetic.
- **Images:**
  - Respect the licensing notes. TCGdex's MIT licence covers data, not card images (© The Pokémon Company, Nintendo, Creatures, GAME FREAK), so keep the attribution in `components/card-data-attribution.tsx`.
  - Only mirror `assets.tcgdex.net` card images.
  - Stay within the **R2 free tier** (10 GB-month storage, 1M Class A and 10M Class B operations per month) and keep the backfill budgets.
- **Shared domain types live in `lib/domain/`**, and pricing types in `lib/card-pricing.ts`. Don't redeclare them in hooks or components.
- **Quality bar:** no new lint warnings, typecheck clean, unit tests for new logic, and e2e for user-visible behaviour.
- **Shared machines:** use your own dev or test port, and don't kill processes you didn't start.

## Code conventions

- TypeScript strict. Use `@/` path imports. Use `import type` for type-only imports.
- Keep pure logic in `lib/` (unit-testable, no React), and keep components and hooks thin.
- Client components start with `"use client"`. The service-role admin client is server-only (load it with `await import()` from shared modules).
- Unit tests use `import { describe, test } from "node:test"` and `node:assert/strict`, not `bun:test` (TS 6 doesn't load Bun's types).
- Normalize untrusted input (API bodies, DB rows, localStorage) with the `normalize*` and `is*` helpers before use.
- API routes return JSON errors with proper status codes (401, 400, 409, 503 and so on), and compare secrets in constant time.
- Use semantic HTML and ARIA labels on icon-only buttons. e2e tests locate elements by role and accessible name.
- Modals and rarely used views load with `next/dynamic`. An SSR-kept dynamic view needs a `loading` option so it gets its own Suspense boundary; without one, the whole shell (including the dock) suspends.

## Definition of done

- [ ] One concern per PR and commit, on a short-lived branch off the latest `main`; independent features use separate branches wherever possible
- [ ] `bun run test` passes, with new logic covered in `tests/`
- [ ] `bun run typecheck` is clean
- [ ] `bun run lint` passes with no new warnings, and the cap is lowered if you removed some
- [ ] `bun run build` passes
- [ ] `bun run test:e2e` passes on all 6 projects (3 widths × browser and standalone). UI changes were checked at 375, 390 and 430 with insets.
- [ ] Overlays use `useOverlay` and pass the overlay e2e expectations
- [ ] Works offline (or degrades clearly), with no per-user data cached in the service worker
- [ ] No invented data. Price signals are confidence-gated.
- [ ] Migrations are numbered, idempotent and listed in `scripts/MIGRATIONS.md`, applied to the target Supabase project and verified. The PR records what was applied.
- [ ] No secrets in the diff, and new env vars are added to `.env.example`
- [ ] The PR description says what changed, why, how it was verified and any follow-ups. It was pushed once, and merged after Vercel was green or the quota exception was verified and deployment was reported as pending.

## Skills

| Skill | Use it when |
|---|---|
| [adding-a-new-tcg-set](.agents/skills/adding-a-new-tcg-set/SKILL.md) | A new set is released: sync it and back-fill its images |
| [adding-a-db-migration](.agents/skills/adding-a-db-migration/SKILL.md) | Changing the Supabase schema |
| [adding-an-overlay-or-sheet](.agents/skills/adding-an-overlay-or-sheet/SKILL.md) | Adding any modal, sheet or popover |
| [writing-e2e-tests](.agents/skills/writing-e2e-tests/SKILL.md) | Adding Playwright coverage (harness, mocks, viewports, offline) |
| [pricing-signal-changes](.agents/skills/pricing-signal-changes/SKILL.md) | Touching providers, confidence, Rising or Breakout |
| [offline-and-caching](.agents/skills/offline-and-caching/SKILL.md) | Touching `sw.js`, IndexedDB or the offline queue |
| [mobile-ui-verification](.agents/skills/mobile-ui-verification/SKILL.md) | Any UI change |
| [release-and-deploy](.agents/skills/release-and-deploy/SKILL.md) | Opening, checking and merging PRs on the Hobby plan |

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

**Keep this block, including in commits.** It is part of the project's agent setup, maintained by `next dev` for every agent that works here. If it appears as an uncommitted change, that is intentional — commit it as-is. Do not remove it to clean up a diff; it will be regenerated.
<!-- END:nextjs-agent-rules -->
