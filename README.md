# Holo Folder

Pokémon card collections at [holofolder.com](https://holofolder.com). The public app lives at [holofolder.com/app](https://holofolder.com/app). See [routing](docs/app-routing.md) for the Framer/Vercel boundary.

Mobile-first Pokémon binder tracker: National Dex binder pages, collection and wanted lists, card matching and scanning, partner (shared) collections, read-only share links and card price tracking. Built with Next.js (App Router), Supabase and Bun, and deployed on Vercel from `main`.

Working on this repo with an AI coding agent? Start with [AGENTS.md](AGENTS.md) and the playbooks in [`.agents/skills/`](.agents/skills/).

## Getting started

Requirements: [Bun](https://bun.sh) and a Supabase project.

```bash
bun install --frozen-lockfile
cp .env.example .env.local   # fill in the Supabase URL, anon key and service role key
bun run dev                   # http://localhost:3000/app
```

The database schema lives in `scripts/NNN_*.sql`. Follow [scripts/MIGRATIONS.md](scripts/MIGRATIONS.md) when creating your own Supabase project. The historical `002`/`003` files are missing: create the documented `user_settings` table before `012`. Some index statements must run outside transactions. The sequence has been replayed on isolated PostgreSQL with synthetic auth/storage scaffolding; a full Supabase Auth/Storage smoke test remains unverified.

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run lint` | ESLint |
| `bun run typecheck` | Generate Next.js route types, then check the full repository with the pinned Rust `tsrs` checker |
| `bun run typecheck:tsc` | Run the TypeScript reference checker for diagnostic comparison |
| `bun run test` | Unit tests (`tests/*.test.ts`, `node:test` style, run by Bun) |
| `bun run test:e2e` | Playwright scenarios (`e2e/*.e2e.ts`) at 390×844, in browser and installed-app (standalone) mode. Builds and serves the app on port 3210 with `HOLOFOLDER_E2E=1` and a mocked Supabase |
| `bun run test:e2e:matrix <spec>` | Run affected specs at 375, 390 and 430 px in browser and standalone mode. Required for UI changes |
| `bun run test:e2e:smoke` | Fast feedback: card browsing, Quick mode navigation and offline card lookup in the two default phone projects. Run the full suite when explicitly requested |
| `bun run test:e2e:install` | Installs Playwright's Chromium (or set `CHROME_PATH` to a local Chrome) |
| `bun run sync-card-db` | Syncs the TCGdex card database into Postgres (needs `POSTGRES_URL_NON_POOLING`; `--dry-run` supported) |

E2E tips: set `E2E_PORT` to use another port, or `E2E_BASE_URL` to test an already running server.

GitHub Actions runs unit tests, the lint warning ratchet and full-repository typechecking within the existing **Typecheck** check on pull requests and `main`, in parallel with Vercel. Both checks must pass before merging. Vercel skips its duplicate TypeScript pass; local builds still check types. GitHub's current plan does not enforce required checks on this private repository, so this is a release-policy gate.

`tsrs` is pinned to `0.23.0-ts7.1.0-beta` and uses its default checker settings. It is experimental; compare unexpected diagnostics with `bun run typecheck:tsc`. TypeScript 6 remains installed for the editor, ESLint and other compiler-API integrations.

For persistent local test servers, synthetic credentials and focused Playwright runs, see [the testing guide](docs/testing.md). Test placeholders are separate from real service configuration in `.env.local`.

## Card data sync on Vercel

`POST /api/admin/sync-card-db` runs the card sync on Vercel (Bearer `CARD_DB_SYNC_SECRET`, `SYNC_SECRET` or `CRON_SECRET`). Pass `?set=<id>,<id>` to sync specific sets, and repeat the call until the response has `"done": true`.

## Environment variables

See [`.env.example`](.env.example) for every variable and what it's for. Only the three Supabase values are needed for local development.

See the [documentation index](docs/README.md) and [architecture guide and diagrams](docs/architecture.md) for data flow, ownership and offline boundaries.

## Project layout

- `app/`: routes, pages and API route handlers
- `components/`: React components (`binder-app.tsx` is the main client app; `components/ui/` holds the shadcn primitives in use)
- `hooks/`: client hooks (collection, settings, prices, overlays)
- `lib/`: shared logic (`lib/domain/` for card types, pricing, sync, scanning)
- `workflows/`: Vercel Workflow definitions (price refresh)
- `scripts/`: SQL migrations and CLI scripts
- `tests/`, `e2e/`: unit and Playwright tests

## Contributing, security and licensing

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The original code is licensed under [AGPL-3.0-only](LICENSE). Third-party code, fonts, artwork and branding have separate terms. Open-source preparation is in progress. [docs/open-source-readiness.md](docs/open-source-readiness.md) records the audit scope and remaining publication gates.

The hosted service, production credentials, private account data and Framer marketing site are not included. Forks must use their own infrastructure. Optional analytics require your own measurement ID. Stripe setup requires an explicit expected account and webhook URL; billing return URLs use `NEXT_PUBLIC_SITE_URL`. See `.env.example` and the integration guides before enabling them.
