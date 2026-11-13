---
name: writing-e2e-tests
description: Write Playwright end-to-end tests for Holo Folder using the /e2e-harness page, the Harness fixture, mocked backends, the six phone viewport projects (browser and standalone PWA) and offline mode. Use when adding or changing user-visible behaviour.
---

# Writing e2e tests

The suite lives in `e2e/*.e2e.ts`. `playwright.config.ts` defines 6 projects: **375×667, 390×844 and 430×932**, each as `browser-*` and `standalone-*`. Standalone projects emulate `display-mode: standalone` with safe-area insets of 59 px top and 34 px bottom (`SAFE_AREA` in `e2e/fixtures.ts`).

Every test runs on `browser-390x844`. The other five projects run only tests tagged **`@matrix`**: the ones whose assertions depend on the viewport or standalone mode (safe areas, overflow, dock clearance, sheet and toolbar geometry, keyboard avoidance), or that skip outside standalone. Tag a test or describe with `{ tag: '@matrix' }` only for that; a flow that merely opens a sheet doesn't qualify. `bun run test:e2e:matrix` runs every test on all six.

Defaults are 20 s per test and 5 s per `expect`. A test that genuinely needs longer says so with `test.slow()` or `test.setTimeout()`.

## How it runs

- `bun run test:e2e e2e/<affected>.e2e.ts` runs focused specs. Always select affected specs or named tests. Bare `bun run test:e2e` runs the full suite and is allowed only when Cal explicitly asks.
  - Each run starts its **own** servers: the app on `E2E_PORT` (default 3210) and the synthetic PostgREST backend on `E2E_BACKEND_PORT` (default `E2E_PORT` + 20000). If either port is taken, the run fails straight away; pick another `E2E_PORT`. It never reuses a running server unless you set `E2E_REUSE=1`.
  - The app is built into `.next-e2e` (not `.next`) by `scripts/e2e-server.ts`, which skips `next build` when the source outside `e2e/` and the baked-in env are unchanged since the last e2e build. `E2E_REBUILD=1` forces a build. Keep your `E2E_PORT` stable to reuse builds, since the backend URL is baked in.
  - The e2e server ignores `.env.local`, so local runs behave like CI and never reach real Supabase, Postgres or Stripe.
  - `E2E_BASE_URL=http://localhost:<port>` tests a server that's already running. Build and start it yourself with `HOLOFOLDER_E2E=1`, and set `E2E_BACKEND_PORT` (or `NEXT_PUBLIC_SUPABASE_URL`) to the backend URL baked into that build.
  - `E2E_WORKERS=<n>` overrides the worker count (4 locally).
- **Did my change break anything?** Run `bun run test:e2e:compare e2e/<affected>.e2e.ts [--project …]`. It runs the specs here with one retry; if anything fails, it checks out `origin/main` in a reusable worktree under the system temp folder, builds and serves it on `E2E_PORT`+1, and reruns the failing files there. It prints only tests that fail here but pass on main, new failing tests and flaky ones, and exits 1 on a regression. Don't hand-roll baseline comparisons.
- Tests drive `/e2e-harness`, a seeded `BinderApp` that returns 404 unless `HOLOFOLDER_E2E=1`. `?signedIn=1` plants a fake session. `?binders=1` gives the owner two binders ("My binder" and "Trades", which holds only Charmander), `?binder=<id>` opens one and `?partner=1` makes the signed-in user the owner's partner; see `e2e/binders.e2e.ts` for a fake `/api/binders`.
- `mockBackends()` mocks Supabase, the collection, settings, card data, prices and `/api/card-image-proxy`. **Tests never hit the internet or a real database.**
- Service workers are blocked by default.

## Steps

1. Import from the fixtures, not from `@playwright/test`:
   ```ts
   import { test, expect } from './fixtures';
   test.describe('thing', () => {
     test.use({ signedIn: true });
     test('does X', async ({ harness }) => {
       /* harness.page, harness.dock(), … */
     });
   });
   ```
2. Use the harness helpers:
   - `dock()`, `dialogs()`, `openCardDetail()`, `closeControl(dialog)`
   - `expectWithinSafeViewport`, `expectHittable`, `expectMinTapTarget(locator, 36)`, `expectNoHorizontalOverflow()`, `expectScrollUnlocked()`
   - `tapBackdrop(dialog)`, `swipeDown(dialog)`
   - `harness.viewport` and `harness.insets` for geometry assertions
3. **Locate by role and accessible name** (`getByRole("dialog", { name: … })`, `getByRole("button", { name: … })`). Add ARIA labels to the app rather than CSS selectors to the test.
4. **Wait for state; don't sample it.** Use `await expect(locator).toBeVisible()` and `expect.poll(...)`. Avoid `locator.all()` or `boundingBox()` straight after a click, because lazy chunks and animations land asynchronously.
5. **Prices:** use `mockCardPrices(page, { "<cardId>": { confidence, market, trend } })` from `e2e/price-fixtures.ts`. Comment every fixture as synthetic, e.g. `// Fixture: high confidence, +25% vs 30d`.
6. **Offline:** follow `e2e/offline.e2e.ts`.
   - Extend the base test with `serviceWorkers: "allow"`, and call `mockBackends(page.context(), page.context(), …)` at context level so the worker's requests are mocked.
   - Go offline with `context.setOffline(true)` plus CDP network emulation (`goOffline`).
   - Wait until the worker controls the page before you go offline.
7. Run the new or changed specs. Tag layout assertions `@matrix`, and for mobile UI use `bun run test:e2e:matrix e2e/<affected>.e2e.ts` to cover all 6 phone projects. When something fails, run `bun run test:e2e:compare` before assuming your change caused it. Repeat a focused test only when a failure or suspected flakiness justifies it.
8. Report the focused command and result in the PR. Run the full e2e suite only when Cal explicitly asks; opening a PR does not require it.
