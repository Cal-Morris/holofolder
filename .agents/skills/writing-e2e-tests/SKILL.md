---
name: writing-e2e-tests
description: Write Playwright end-to-end tests for Holo Folder using the /e2e-harness page, the Harness fixture, mocked backends, the six phone viewport projects (browser and standalone PWA) and offline mode. Use when adding or changing user-visible behaviour.
---

# Writing e2e tests

The suite lives in `e2e/*.e2e.ts`. `playwright.config.ts` defines 6 projects: **375×667, 390×844 and 430×932**, each as `browser-*` and `standalone-*`. Standalone projects emulate `display-mode: standalone` with safe-area insets of 59 px top and 34 px bottom (`SAFE_AREA` in `e2e/fixtures.ts`). Only the 390×844 browser and standalone projects run by default; `test:e2e:matrix` explicitly selects all six.

## How it runs

- `bun run test:e2e e2e/<affected>.e2e.ts` runs a focused spec in the two default projects, building the app and serving it on port 3210 with `HOLOFOLDER_E2E=1`. Always select affected specs or named tests. Bare `bun run test:e2e` runs the full suite and is allowed only when Cal explicitly asks.
  - `E2E_PORT=<port>` picks another port. Use your own port on shared machines.
  - `E2E_BASE_URL=http://localhost:<port>` tests a server that's already running. Build and start it yourself with `HOLOFOLDER_E2E=1` plus the Supabase envs pointed at a dummy URL.
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
7. Run the new or changed specs across the relevant projects. For mobile UI, use `bun run test:e2e:matrix e2e/<affected>.e2e.ts` to cover all 6 phone projects. Repeat a focused test only when a failure or suspected flakiness justifies it.
8. Report the focused command and result in the PR. Run the full e2e suite only when Cal explicitly asks; opening a PR does not require it.
