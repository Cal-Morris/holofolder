# Holo Folder

Pokémon card collections at [holofolder.com](https://holofolder.com). See [the rebrand cutover checklist](docs/holo-folder-rebrand.md) before switching the production domain.

Mobile-first Pokémon binder tracker: National Dex binder pages, collection and wanted lists, card matching and scanning, partner (shared) collections, read-only share links and card price tracking. Built with Next.js (App Router), Supabase and Bun, and deployed on Vercel from `main`.

Working on this repo with an AI coding agent? Start with [AGENTS.md](AGENTS.md) and the playbooks in [`.agents/skills/`](.agents/skills/).

## Getting started

Requirements: [Bun](https://bun.sh) and a Supabase project.

```bash
bun install
cp .env.example .env.local   # fill in the Supabase URL, anon key and service role key
bun run dev                   # http://localhost:3000
```

The database schema lives in `scripts/NNN_*.sql`. Apply the files to your Supabase project in numeric order (gaps in the numbering are expected).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run lint` | ESLint |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run test` | Unit tests (`tests/*.test.ts`, `node:test` style, run by Bun) |
| `bun run test:e2e` | Playwright end-to-end suite (`e2e/*.e2e.ts`) at three phone sizes, in browser and installed-app (standalone) mode. Builds and serves the app on port 3210 with `HOLOFOLDER_E2E=1` and a mocked Supabase |
| `bun run test:e2e:smoke` | Fast feedback: card browsing, Quick mode navigation and offline card lookup across all six phone projects. The full suite is still required before release |
| `bun run test:e2e:install` | Installs Playwright's Chromium (or set `CHROME_PATH` to a local Chrome) |
| `bun run sync-card-db` | Syncs the TCGdex card database into Postgres (needs `POSTGRES_URL_NON_POOLING`; `--dry-run` supported) |

E2E tips: set `E2E_PORT` to use another port, or `E2E_BASE_URL` to test an already running server.

For repeated test runs, use a persistent production server on your own port. Set these synthetic test values in **both terminals**, overriding any real values in `.env.local`:

```sh
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399
export NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon-key
export NEXT_PUBLIC_VAPID_PUBLIC_KEY=c3ludGhldGljLWUyZS12YXBpZC1wdWJsaWMta2V5
# First terminal
HOLOFOLDER_E2E=1 bun run build
HOLOFOLDER_E2E=1 bun run start -p 3279
# Second terminal
E2E_BASE_URL=http://localhost:3279 bun run test:e2e:smoke --workers=2
```

This avoids rebuilding between test edits or reruns. After changing app code, stop the server, rebuild and restart it. Run a relevant spec against the same server with `E2E_BASE_URL=http://localhost:3279 bun run test:e2e e2e/card-browser.e2e.ts --workers=2`. Without `E2E_BASE_URL`, the normal command handles the build and server automatically.

Local runs capture a screenshot on failure without recording every passing test. To debug a failure with a trace, rerun its spec with `--trace=retain-on-failure`; CI records traces on the first retry. Keep `.next/cache` between builds: Next.js already uses Turbopack and its filesystem build cache by default.

## Card data sync on Vercel

`POST /api/admin/sync-card-db` runs the card sync on Vercel (Bearer `CARD_DB_SYNC_SECRET`, `SYNC_SECRET` or `CRON_SECRET`). Pass `?set=<id>,<id>` to sync specific sets, and repeat the call until the response has `"done": true`.

## Environment variables

See [`.env.example`](.env.example) for every variable and what it's for. Only the three Supabase values are needed for local development.

## Project layout

- `app/`: routes, pages and API route handlers
- `components/`: React components (`binder-app.tsx` is the main client app; `components/ui/` holds the shadcn primitives in use)
- `hooks/`: client hooks (collection, settings, prices, overlays)
- `lib/`: shared logic (`lib/domain/` for card types, pricing, sync, scanning)
- `workflows/`: Vercel Workflow definitions (price refresh)
- `scripts/`: SQL migrations and CLI scripts
- `tests/`, `e2e/`: unit and Playwright tests
