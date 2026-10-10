# binderdex

Mobile-first Pokémon binder tracker: National Dex binder pages, collection and wanted lists, card matching and scanning, partner (shared) collections, read-only share links and card price tracking. Built with Next.js (App Router), Supabase and Bun, and deployed on Vercel from `main`.

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
| `bun run test:e2e` | Playwright end-to-end suite (`e2e/*.e2e.ts`) at three phone sizes, in browser and installed-app (standalone) mode. Builds and serves the app on port 3210 with `BINDERDEX_E2E=1` and a mocked Supabase |
| `bun run test:e2e:install` | Installs Playwright's Chromium (or set `CHROME_PATH` to a local Chrome) |
| `bun run sync-card-db` | Syncs the TCGdex card database into Postgres (needs `POSTGRES_URL_NON_POOLING`; `--dry-run` supported) |

E2E tips: set `E2E_PORT` to use another port, or `E2E_BASE_URL` to test an already running server.

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
