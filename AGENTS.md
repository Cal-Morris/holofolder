# AGENTS.md

This is the canonical guide for AI coding agents (and humans) working on **Holo Folder**. `CLAUDE.md`, `.cursor/rules/` and `.github/copilot-instructions.md` all point here. Task-specific playbooks are in [`.agents/skills/`](.agents/skills/) (one folder per skill, each with a `SKILL.md`).

## What this is

Holo Folder is a mobile-first Pokémon binder tracker, served at https://holofolder.com/app, with Framer serving the marketing site at https://holofolder.com. It covers:
- National Dex binder pages
- collection and wanted lists
- card matching and camera scanning
- several named binders per owner, partner (shared) collections and read-only share links per binder
- card prices with confidence-gated signals
- an installable PWA that works offline

Stack:
- **Next.js 16** (App Router, Turbopack, `cacheComponents`)
- **React 19** and **TypeScript 6**
- **Bun**
- **Tailwind**, with shadcn primitives in `components/ui/`
- **Supabase** (auth, Postgres, Realtime)
- **Vercel** (hosting, Workflows, cron), with a **Cloudflare R2** card image mirror

## Public URL boundary

Framer serves `https://holofolder.com`; its Multi Site rules proxy `/app` and `/app/*` to the same paths on the Vercel origin `https://app.holofolder.com`. Next.js builds with `basePath: "/app"`. Route names below describe source routes; public URLs, raw fetches, images and service workers need the `/app` prefix. Next Link/router destinations remain unprefixed. Local entry is `http://localhost:3000/app`. See [`docs/app-routing.md`](docs/app-routing.md), including auth, legacy installs and paused push/branding branches.

Developer clients connect directly to `https://app.holofolder.com/app/api/v1` (REST) and `https://app.holofolder.com/app/mcp` (MCP), bypassing Framer so OAuth discovery headers survive. The app’s internal API calls remain same-origin.

See [docs/architecture.md](docs/architecture.md) for ownership, startup, synchronization and caching boundaries, and [docs/README.md](docs/README.md) for maintained guides versus historical plans.

## Architecture map

| Path | What lives there |
|---|---|
| `app/` | Routes and API handlers. `page.tsx` is the binder (server bootstrap via `lib/server/`), plus `home/`, `auth/`, `share/` (read-only binders) and `app-shell/` (static offline shell). `e2e-harness/` is served only when `HOLOFOLDER_E2E=1`. |
| `app/api/` | `collection`, `binders` (create, rename, reorder, delete), `settings`, `binder-share`, `card-prices` (+ `refresh` for the cron and on-demand workflow), `tcgdex-cache`, `tcg-set-slots`, `tcg-card-search`, `card-image-proxy`, and `admin/{sync-card-db,mirror-card-images}`. |
| `proxy.ts` | Next 16 request proxy (formerly middleware). It refreshes the Supabase session. |
| `components/` | `binder-app.tsx` is the main client app (binder, list, wanted and sets views, dock, card detail sheet). Modals and secondary views (`settings-modal`, `auth-modal`, `partner-modal`, `card-selector`, `pokemon-cards-browser`, `dex-list-view`, `set-population-view`, `quick-mode`) are `next/dynamic` imports. `quick-mode.tsx` is the one-handed Quick mode palette (hold the dock's Search, Ctrl/Cmd+K, or the Search sheet's button); its destinations and recent searches live in `lib/quick-mode.ts`. Show mode (card shows: header "Show" pill on every view, binder prompt card, amber on-banner with Exit, screen Wake Lock, dock Search opens Quick mode) is a device setting in `lib/show-mode.ts` and `hooks/use-show-mode.ts`. In Show mode, tapping a Quick mode card opens the deal checker (`quick-card-check.tsx`, keypad and verdict in `deal-keypad.tsx`, bundles in `quick-bundle.tsx`): verdict rules and thresholds are pure in `lib/deal-check.ts` (thresholds editable in Settings via `deal-settings.tsx`); the per-show purchase tally lives in `lib/show-session.ts` + `hooks/use-show-session.ts` and syncs to the collection owner's account (`public.show_purchases`, `scripts/041_show_purchases.sql`, owner-or-partner RLS like binders) via `lib/show-purchase-sync.ts` + `hooks/use-show-purchase-sync.ts`: purchases and undos are queued on the device, pushed when online (idempotent on `owner_user_id,client_id`), then the current show's purchases are pulled back (Settings → Clear only resets this device's tally). Show mode's Quick mode opens on the finder: the "Hunting" list (`show-hunt.tsx`: want list grouped by Pokémon, sort, era/set/illustrator filters, pay-up-to per card) and, from a Pokémon result, `show-pokemon-cards.tsx` (wanted first, owned dimmed last); grouping, eras (by set-id prefix) and order are pure in `lib/show-hunt.ts`, prices via `hooks/use-display-card-prices.ts`. Both are bundled into `quick-mode` (not split) so they work offline. Searching in Show mode finds any card (server mirror search by name, set, number or illustrator; offline, the cards cached on the device), wanted first and labelled Wanted / Owned / Not in binder; the want list's search offers "Check price of any card", which opens Quick mode as a lookup-only "Price check" (`lookupOnly`, `initialQuery`) with the same deal checker. Both have a Scan button (`quick-card-scanner.tsx`, bundled into `quick-mode`): the camera (`hooks/use-camera-stream.ts`, shared with `card-selector`) reads the name and collector number on the device (`lib/card-scan-ocr.ts`: native TextDetector, else tesseract.js, which downloads from jsDelivr on first use and is warmed when the scanner opens online), `lib/card-scan-identify.ts` turns the text into a search and only opens the deal checker on one clear match; otherwise the read text is typed into the search with a notice. Offline it matches only cards cached on the device. |
| `hooks/` | `use-settings`, `use-card-prices`, `use-overlay` (the shared overlay primitive), `use-card-search` (card, illustrator and set search, online or from the offline card index; set hits in Search and Quick mode open Sets on that set), `use-tcgdex`, `use-partner`, `use-slot-offline-queue` (native storage command queue), `use-collapse-on-scroll`, `use-touch-gestures`. |
| `lib/domain/` | Shared card domain types and normalizers: `CARD_LANGUAGES`, `CARD_FINISHES`, `SLOT_STATUSES`, `WantedCard`, `CollectedPokemon`, `TCGCard`. |
| `lib/collection/` | Collection logic: `normalize`, `sync` (fingerprints) and native storage (`inventory-read-*`, `storage-command-browser`, `slot-offline-queue`, `slot-snapshot`). |
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
   - `binders` (named binders per owner, one `is_default`; `docs/multiple-binders.md`), the native storage tables (`storage_collection_state`, `binder_slots`, `inventory_items`, `inventory_placements`, `inventory_owner_state`), `user_settings`, `partnerships` / `partner_invites` and `binder_shares`, all with RLS.
   - History: every writer records one `collection_activity` row itself (migration 108). The row's `changes` holds the whole before/after rows for Undo; readers project only the fields they show (`projectActivityChanges` in `lib/collection-activity.ts`), so certificates, labels and artwork never leave the server.
   - Partners share the owner's collection (`lib/server/collection-owner.ts`), so they get every binder of the owner automatically.
   - Every binder is native: creating one (`create_collection_v1`, `developer_create_binder`, `ensure_default_binder`) writes its `storage_collection_state` row in the same transaction (migration 105). Binders open at `/app/<slug>/binder/<page>` (slug from migration 106, see `docs/app-routing.md`); `/` opens `?binder=`, else the `binderdex_binder` cookie (last opened on this device), else the default; `BinderApp` remounts per binder. Requests without a binder id use the owner's default binder.
   - The app runs one collection model: native slot storage. Signed-in clients read through `/api/inventory` and send storage commands (`/api/binder-slots`, `/api/inventory`, `/api/storage-collections`) from `lib/collection/storage-command-browser.ts`, queued durably on the device (`lib/collection/slot-offline-queue.ts`) and replayed when back online.
   - Signed-out guests are read-only: they can browse the Dex, Sets, search, card details, prices and Show mode price checks, and every collection edit opens the sign-up dialog instead (`requireAccount` in `components/binder-app.tsx`). Nothing is stored on the device for them.
3. **Pricing.**
   - Providers include TCGplayer, Cardmarket and PokePulse (`PriceProvider` in `lib/price-intelligence.ts`).
   - Results are normalised to GBP with ECB FX rates and stored in `card_prices` with confidence, range, per-source evidence and trend points.
   - The refresh runs through `workflows/card-price-refresh.ts`: daily via cron (`vercel.json` → `GET /api/card-prices/refresh`, `CRON_SECRET`) and on demand (`POST`, signed-in user).
   - The client caches prices in localStorage (`hooks/use-card-prices.ts`).
   - Rising and Breakout signals are computed client-side from trend points, behind confidence gates.
4. **Images.**
   - Public card images load directly from `https://assets.holofolder.com/cards/...`, with stored low/high variants. `/api/card-image-proxy` remains the miss and compatibility fallback; Pokémon artwork still uses its resizing path.
   - TCGdex card images, and fallback-source images (TCGplayer, pokemontcg.io, Scrydex, Limitless) for cards TCGdex has no image for, are mirrored into R2 (or Blob) under deterministic keys (see `docs/card-image-store.md`). On a miss the proxy serves the origin and uploads afterwards. Blocked or throttled stores are skipped for a cooldown.
   - Pokémon artwork from PokeAPI is resized by the proxy (`&w=` in 96/160/240/320/480).
   - The response header `x-card-image-source` is `r2`, `blob`, `tcgdex` or `upstream`.
5. **Offline.**
   - `public/sw.js` precaches the static `/app-shell` and its assets, and serves it for failed or stalled navigations (not `/auth/*` or `/share/*`).
   - Card data is network-first with a 5 s cache fallback. Images are cache-first, capped at 1,500 entries.
   - The app warms the cache for visible slots.
   - `components/offline-app-shell.tsx` boots the binder from on-device data only.
   - `/` paints `BinderSkeleton` from the static shell, then `components/binder-start.tsx` shows the saved binder straight away (the same account, owner and binder the server last opened, from `lib/binder-start.ts`) or the server's collection, whichever comes first.

## Setup

```bash
bun install
cp .env.example .env.local   # fill in the values you need
bun run dev                  # http://localhost:3000/app
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
| `bun run typecheck` | `next typegen && tsrs --noEmit`; checks the full repo with the pinned Rust checker. `bun run typecheck:tsc` compares reference diagnostics. Local builds also type-check; Vercel relies on Typecheck CI. |
| `bun run lint` | ESLint with **`--max-warnings=59`**. This is a ratchet: never add warnings. If you remove some, lower the cap in `package.json`. Prefix intentionally unused vars with `_`. |
| `bun run build` | Production build |
| `bun run test:e2e` | Playwright at 390×844 in browser and standalone mode: builds and serves on port 3210 (`E2E_PORT` to change it, `E2E_BASE_URL` to test a running server) with `HOLOFOLDER_E2E=1` |
| `bun run test:e2e:matrix <spec>` | Affected specs across all six phone projects (375, 390 and 430 px, browser and standalone). Required for UI changes |
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
- **Performance rules:**
  - Write RLS with `(select auth.uid())`.
  - Page reads that can pass PostgREST's 1000-row cap.
  - Run `CONCURRENTLY` index changes one statement at a time.
  - Verify with `EXPLAIN ANALYZE` inside a rolled-back `begin`.

  Details are in the skill's "Performance conventions".

See the skill [`adding-a-db-migration`](.agents/skills/adding-a-db-migration/SKILL.md).

## Deployment

- **Ship small, scoped changes by default.** Unless Cal explicitly asks for local-only work, completing a small change includes committing it on its own branch, pushing the branch, opening a PR, and merging once CI and all required reviews pass. Run focused local checks when useful for the change; a full local test, build or e2e run is not required by default. Run the full e2e suite only when Cal explicitly asks for it. Continue through production deployment verification using the `release-and-deploy` skill. This is standing authorization for those steps; don't stop at "fixed locally" or ask for separate permission to commit, push, open the PR or merge. If a gate fails, fix failures within the task's scope or report the concrete blocker. The verified quota exception below still applies.
- Vercel deploys `main` to production. Every PR push gets a preview deployment. Both **Typecheck** (GitHub Actions) and **Vercel** must pass before merging. The current GitHub plan does not enforce required checks on this private repo; agents must enforce this release-policy gate.
- The project is on the **Hobby plan**, which has a daily deployment limit. Every push, rebase and merge costs a deploy. So:
  - **push once per PR after any focused checks the change needs**
  - don't push "retry" commits
  - only rebase when GitHub says the branch is out of date or conflicting
  - merge one PR at a time
- **Keep merging when Vercel explicitly reports "Deployment rate limited" or an exhausted account build/deployment quota.** Verify the check details, run `bun run test`, `bun run typecheck`, `bun run lint` and `bun run build` on the current PR head (no full e2e required), and require every other required check and review to pass. Record the quota failure and local validation in the PR, then merge without waiting for the reset or pushing retry commits.
- A quota-blocked merge is **merged, deployment pending**. After the limit resets, deploy the latest `main` and verify its production deployment; don't redeploy an older PR head.
- GitHub Actions runs unit tests, the lint warning ratchet and full-repo typechecking in the existing **Typecheck** workflow, in parallel with Vercel, which skips duplicate type-checking. Don't add other workflows unless the owner asks.

See the skill [`release-and-deploy`](.agents/skills/release-and-deploy/SKILL.md).

## Principles

- Product branding is **Holo Folder** (`holofolder.com`), package and tooling names use `holofolder` / `HOLOFOLDER`. Existing `binderdex` storage keys and service-worker protocols are compatibility identifiers, keep them stable (see `docs/holo-folder-rebrand.md`). Repository, local folder and Vercel project renames are managed separately by Cal.

- **Small, focused PRs and commits, one concern each.** Use a separate short-lived branch off the latest `main` for each independent feature or fix wherever possible. Split unrelated work before committing; keep dependent changes together when needed for a working PR. No drive-by refactors. Say what was verified and what wasn't.
- **Merge on green Typecheck and Vercel checks, or green Typecheck plus the verified Vercel quota exception above.** Real build failures and other unmet checks or reviews still block merging. Admin merge is allowed only when needed to bypass the quota-only Vercel check after every other requirement passes. Never skip hooks.
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
- **Quality bar:** no new lint warnings, typecheck clean, unit tests for new logic, and focused e2e coverage where useful for user-visible behaviour. Do not run the full e2e suite unless Cal explicitly asks.
- **Shared machines:** use your own dev or test port, and don't kill processes you didn't start.

## Code conventions

- TypeScript strict. Use `@/` path imports. Use `import type` for type-only imports.
- Keep pure logic in `lib/` (unit-testable, no React), and keep components and hooks thin.
- Client components start with `"use client"`. The service-role admin client is server-only (load it with `await import()` from shared modules).
- Unit tests use `import { describe, test } from "node:test"` and `node:assert/strict`, not `bun:test` (TS 6 doesn't load Bun's types).
- Normalize untrusted input (API bodies, DB rows, localStorage) with the `normalize*` and `is*` helpers before use.
- API routes return JSON errors with proper status codes (401, 400, 409, 503 and so on), and compare secrets in constant time.
- Use semantic HTML and ARIA labels on icon-only buttons. e2e tests locate elements by role and accessible name.
- Pages don't `await` the session or cookies at the top level: pass a promise to a client component and `use()` it inside `<Suspense>`, so the page stays in the static shell. Read the user with `getSessionUser`/`getClaims` (local JWT check), not `getUser()`, except in write routes. See [`nextjs-conventions`](.agents/skills/nextjs-conventions/SKILL.md).
- Modals and rarely used views load with `next/dynamic`. An SSR-kept dynamic view needs a `loading` option so it gets its own Suspense boundary; without one, the whole shell (including the dock) suspends.

## Feature delivery and marketing

Cal authorizes completing each feature through ready PR merges and verified production deployment, then publishing the matching Framer marketing updates. API implementation and docs ship with **every feature delivery**; release posts/changelog and evergreen site updates ship after **each coherent user-facing feature block**, using current implemented behavior. Keep these as repeatable workflows:

1. [feature-api-docs](.agents/skills/feature-api-docs/SKILL.md): shared REST/MCP contracts, generated OpenAPI/reference/Markdown/LLM exports and current help docs with the feature PR.
2. [release-posts-and-changelog](.agents/skills/release-posts-and-changelog/SKILL.md): existing Framer Blog CMS and a visible CMS-backed changelog for verified shipped blocks.
3. [framer-feature-updates](.agents/skills/framer-feature-updates/SKILL.md): affected homepage, feature/audience pages, copy, screenshots and links, reusing current CMS/components/styles and publishing to production.

Prepare release drafts during implementation. Merge one ready PR at a time under the release policy, verify the enabled main deployment, then finish the scoped Framer updates/publication and record live links on the issue/project. A quota-blocked merge stays deployment-pending and must not be announced as shipped. Internal-only changes may record why no marketing update is warranted. These instructions do not authorize publishing unrelated collaborator edits. Do not call a user-facing feature block complete while its required API/docs or marketing publication is pending.

Use [task-progress](.agents/skills/task-progress/SKILL.md) at start, review, merge, deployment and completion to keep issue checklists, native dependencies and project Status aligned. A merge alone does not mark a feature Done; verify its applicable delivery gates, then close the issue and reconcile its parent/project.

## Definition of done

- [ ] One concern per PR and commit, on a short-lived branch off the latest `main`; independent features use separate branches wherever possible
- [ ] Commit and push, open a PR, and merge once Typecheck, Vercel and required reviews pass
- [ ] API/docs ship with each feature; matching Framer feature pages and CMS release/changelog updates are published and verified after each user-facing feature block, with live evidence on its issue/project
- [ ] Run focused local checks as needed; no full local test, build or e2e run required by default
- [ ] New logic has unit coverage in `tests/`; no new lint warnings, and the cap is lowered if warnings were removed
- [ ] UI changes were checked at 375, 390 and 430 with insets; overlays use `useOverlay` and meet the dismissal requirements
- [ ] Works offline (or degrades clearly), with no per-user data cached in the service worker
- [ ] No invented data. Price signals are confidence-gated.
- [ ] Migrations are numbered, idempotent and listed in `scripts/MIGRATIONS.md`, applied to the target Supabase project and verified. The PR records what was applied.
- [ ] No secrets in the diff, and new env vars are added to `.env.example`
- [ ] The PR description says what changed, why, how it was verified and any follow-ups. It was pushed once, and merged after Vercel was green or the quota exception was verified and deployment was reported as pending.

## Skills

UI craft skills from [Emil Kowalski](.agents/skills/EMIL-SOURCE.md) are vendored in `.agents/skills/`. For UI changes, use `emil-design-eng` for the overall review, `gestures` for drag/swipe interactions, `animate` for new motion, `animation-performance` for jank, and `mobile-native` for touch behaviour. Use `review-animations` and `break-ui` before shipping relevant changes. These complement the project playbooks below; repository accessibility, shared-overlay, offline and release requirements take precedence.

| Skill | Use it when |
|---|---|
| [repo-health](.agents/skills/repo-health/SKILL.md) | A read-only sitrep, current repo health or publication readiness |
| [docs-and-architecture](.agents/skills/docs-and-architecture/SKILL.md) | README/guide upkeep, documentation drift or diagrams of current internals |
| [dependency-maintenance](.agents/skills/dependency-maintenance/SKILL.md) | Dependency upgrades/removals, security alerts or native-library verification |
| [adding-a-new-tcg-set](.agents/skills/adding-a-new-tcg-set/SKILL.md) | A new set is released: sync it and back-fill its images |
| [adding-a-db-migration](.agents/skills/adding-a-db-migration/SKILL.md) | Changing the Supabase schema |
| [adding-an-overlay-or-sheet](.agents/skills/adding-an-overlay-or-sheet/SKILL.md) | Adding any modal, sheet or popover |
| [writing-e2e-tests](.agents/skills/writing-e2e-tests/SKILL.md) | Adding Playwright coverage (harness, mocks, viewports, offline) |
| [pricing-signal-changes](.agents/skills/pricing-signal-changes/SKILL.md) | Touching providers, confidence, Rising or Breakout |
| [offline-and-caching](.agents/skills/offline-and-caching/SKILL.md) | Touching `sw.js`, IndexedDB or the offline queue |
| [mobile-ui-verification](.agents/skills/mobile-ui-verification/SKILL.md) | Any UI change |
| [task-progress](.agents/skills/task-progress/SKILL.md) | Starting, progressing or completing issues: project status, acceptance evidence and parent/dependency reconciliation |
| [feature-api-docs](.agents/skills/feature-api-docs/SKILL.md) | Every feature delivery: shared API parity, generated references and current help docs |
| [release-posts-and-changelog](.agents/skills/release-posts-and-changelog/SKILL.md) | Shipped feature blocks: CMS blog posts and visible changelog |
| [framer-feature-updates](.agents/skills/framer-feature-updates/SKILL.md) | Shipped feature blocks: current Framer feature pages and production publication |
| [release-and-deploy](.agents/skills/release-and-deploy/SKILL.md) | Opening, checking and merging PRs on the Hobby plan |
| [nextjs-conventions](.agents/skills/nextjs-conventions/SKILL.md) | Adding or changing pages, layouts, `proxy.ts`, `next.config` or heavy client dependencies (static shells, getClaims, first-load JS) |

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
