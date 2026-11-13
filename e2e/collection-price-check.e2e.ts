import { test, expect, SEEDED_COLLECTION, seedCollection, type Harness } from './fixtures';
import type { ComparisonJob } from '../lib/comparison-jobs';

test.use({ signedIn: true });
const id = '00000000-0000-4000-8000-000000000050';

/** Synthetic wants in Bulbasaur's pocket, on the native binder. */
async function seedWants(harness: Harness, count: number) {
  const wanted = Array.from({ length: count }, (_, i) => ({
    card_id: `synthetic-${i}`,
    card_name: `Synthetic ${i}`,
    card_language: 'en',
    card_finish: 'normal',
    added_at: '2026-01-01T00:00:00Z',
  }));
  // A repeated want is checked once.
  await seedCollection(harness.page, [
    { ...SEEDED_COLLECTION[0], wanted_cards: [...wanted, wanted[0]] },
    SEEDED_COLLECTION[1],
  ]);
}

test('wanted checks confirm once, survive leaving and reopening, and reconnect offline', async ({ harness }) => {
  const { page } = harness;
  // Synthetic jobs and evidence. No actual provider or workflow calls.
  await seedWants(harness, 65);
  let job: ComparisonJob | null = null;
  let starts = 0,
    stops = 0,
    directChecks = 0;
  await page.route('**/app/api/card-price-checks?**', (route) => {
    if (route.request().method() !== 'GET') directChecks++;
    const cards = JSON.parse(new URL(route.request().url()).searchParams.get('cards') ?? '[]');
    return route.fulfill({
      json: { checks: cards.map((card: object) => ({ ...card, ebay: null, soldcomps: null, errors: {} })) },
    });
  });
  await page.route('**/app/api/comparison-jobs**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { job } });
    const body = route.request().postDataJSON();
    if (body.action === 'inspect') return route.fulfill({ json: { job, needed: 65 } });
    if (body.action === 'stop') {
      stops++;
      job = { ...job!, status: 'cancelled' };
      return route.fulfill({ json: { job } });
    }
    if (!body.confirmed) return route.fulfill({ status: 409, json: { needsConfirmation: true, needed: 65 } });
    starts++;
    job = { id, status: 'running', progress: { total: 65, done: 3, checked: 3, fresh: 0, failed: 0, stopped: {} } };
    return route.fulfill({ status: 202, json: { job } });
  });
  await harness.reload();
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
  const batch = page.getByTestId('collection-price-check');
  await expect(batch).toContainText('65 eligible printings in this binder');
  const start = batch.getByRole('button', { name: 'Check wanted prices' });
  await harness.expectMinTapTarget(start, 36);
  await start.click();
  const dialog = page.getByRole('dialog', { name: /65 cards need/ });
  await expect(dialog).toBeVisible();
  expect(starts).toBe(0);
  await harness.expectWithinSafeViewport(dialog);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(batch).toContainText('Price check cancelled');
  await start.click();
  await dialog.getByRole('button', { name: 'Check now' }).click();
  await expect(batch).toContainText('You can close the app');
  await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
  await expect(batch).toContainText('Checking 3/65 in background');
  expect(stops).toBe(0);
  await page.context().setOffline(true);
  await expect(batch).toContainText('Offline. Checks continue on the server');
  await expect(batch.getByRole('button', { name: 'Stop checking prices' })).toBeDisabled();
  await page.context().setOffline(false);
  job = { id, status: 'completed', progress: { total: 65, done: 65, checked: 60, fresh: 4, failed: 1, stopped: {} } };
  // The app reopens on Wanted, so wait for the dock rather than a binder pocket.
  await page.reload();
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
  await expect(batch).toContainText('60 checked, 4 already saved, 1 incomplete');
  expect(starts).toBe(1);
  expect(directChecks).toBe(0);
  await harness.expectNoHorizontalOverflow();
});

test('explicit Stop cancels the server job', async ({ harness }) => {
  const { page } = harness;
  let stopped = false;
  const job: ComparisonJob = {
    id,
    status: 'running',
    progress: { total: 2, done: 1, checked: 1, fresh: 0, failed: 0, stopped: {} },
  };
  await page.route('**/app/api/comparison-jobs**', (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'stop') stopped = true;
    return route.fulfill({ json: { job: { ...job, status: stopped ? 'cancelled' : 'running' } } });
  });
  await seedWants(harness, 2);
  await harness.reload();
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
  const batch = page.getByTestId('collection-price-check');
  const stop = batch.getByRole('button', { name: 'Stop checking prices' });
  await expect(stop).toBeVisible();
  await harness.expectMinTapTarget(stop, 36);
  await stop.click();
  await expect(batch).toContainText('Stopped. Completed checks are saved');
  expect(stopped).toBe(true);
  await harness.expectNoHorizontalOverflow();
});

test('a slow initial inspection cannot erase a job started in the meantime', async ({ harness }) => {
  const { page } = harness;
  let release: () => void = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job: ComparisonJob = {
    id,
    status: 'running',
    progress: { total: 2, done: 0, checked: 0, fresh: 0, failed: 0, stopped: {} },
  };
  let inspecting = false;
  await page.route('**/app/api/comparison-jobs**', async (route) => {
    if (route.request().method() === 'POST' && route.request().postDataJSON().action === 'inspect') {
      inspecting = true;
      await waiting;
      return route.fulfill({ json: { job: null, needed: 2 } });
    }
    return route.fulfill({ json: { job } });
  });
  await seedWants(harness, 2);
  await harness.reload();
  await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
  await expect.poll(() => inspecting).toBe(true);
  const batch = page.getByTestId('collection-price-check');
  await batch.getByRole('button', { name: 'Check wanted prices' }).click();
  await expect(batch).toContainText('You can close the app');
  const response = page.waitForResponse(
    (response) =>
      response.url().includes('/comparison-jobs') &&
      response.request().method() === 'POST' &&
      response.request().postDataJSON().action === 'inspect',
  );
  release();
  await (await response).finished();
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect(batch.getByRole('button', { name: 'Stop checking prices' })).toBeVisible();
});
