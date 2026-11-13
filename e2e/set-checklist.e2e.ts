import { test, expect } from './fixtures';
import type { TCGSetSlotsResponse } from '../lib/tcg-set-slots';

// Synthetic catalogue includes an unmapped Trainer and one printing associated with two species.
const set = { id: 'fixture-set', name: 'Fixture Set', officialCardCount: 2 };
const card = {
  id: 'fixture-set-1',
  localId: '1',
  name: 'Fixture Bulbasaur',
  language: 'en' as const,
  set,
  inferredFinish: 'normal' as const,
};
const trainer = { ...card, id: 'fixture-set-2', localId: '2', name: 'Fixture Trainer' };
const payload: TCGSetSlotsResponse = {
  sets: [set],
  selectedSet: set,
  cards: [card, trainer],
  slots: [
    { dexId: 1, pokemonName: 'bulbasaur', cards: [card] },
    { dexId: 2, pokemonName: 'ivysaur', cards: [card] },
  ],
};

async function mockSet(page: import('@playwright/test').Page, data: TCGSetSlotsResponse = payload) {
  await page.route('**/app/api/tcg-set-slots**', (route) => {
    const selected = new URL(route.request().url()).searchParams.has('setId');
    return route.fulfill({ json: selected ? data : { sets: [set], selectedSet: null, slots: [] } });
  });
}

async function selectSet(harness: import('./fixtures').Harness) {
  await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
  await harness.page.getByRole('textbox', { name: 'Search sets by name, code or year' }).fill('fixture');
  await harness.page
    .getByRole('button', { name: /Fixture Set/ })
    .first()
    .click();
  await expect(harness.page.getByRole('group', { name: 'Set checklist' })).toBeVisible();
}

test.describe('set checklists', () => {
  test.use({ signedIn: true });

  test('species filters include other-set ownership and wants while printing state stays exact', async ({
    harness,
  }) => {
    const page = harness.page;
    await page.reload();
    await mockSet(page);
    await selectSet(harness);
    await expect(page.getByText('Owned elsewhere', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replace binder card', exact: true })).toBeVisible();
    await harness.expectMinTapTarget(page.getByRole('button', { name: 'Select bulbasaur', exact: true }));
    await harness.expectMinTapTarget(page.getByRole('button', { name: /^Already have 1$/ }));
    await page.getByRole('button', { name: 'Select bulbasaur', exact: true }).click();
    await harness.expectMinTapTarget(page.getByRole('button', { name: 'Replace selected binder cards', exact: true }));
    await page.getByRole('button', { name: 'Deselect bulbasaur', exact: true }).click();
    await page.getByRole('button', { name: /^Already have 1$/ }).click();
    await expect(page.getByRole('button', { name: 'Select bulbasaur', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select ivysaur', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /^Wanted 1$/ }).click();
    await expect(page.getByRole('button', { name: 'Select bulbasaur', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Select ivysaur', exact: true })).toHaveCount(0);
    const cards = page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true });
    await harness.expectMinTapTarget(cards);
    await cards.click();
    const list = page.getByRole('list', { name: 'Fixture Set card checklist', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect
      .poll(() => page.getByTestId('view-scroller').evaluate((element) => element.clientHeight))
      .toBeGreaterThan(80);
    const unmapped = list.getByRole('listitem', { name: /Fixture Trainer/ });
    await expect(unmapped).toContainText('Unavailable for binder');
    await expect(unmapped.getByRole('button')).toHaveCount(0);
    const browse = list.getByRole('button', { name: 'Browse bulbasaur cards' });
    await browse.scrollIntoViewIfNeeded();
    await harness.expectHittable(browse);
    await harness.expectMinTapTarget(browse);
    await page.screenshot({ path: `/tmp/browsing-set-${page.viewportSize()!.width}.png` });
    await expect(list.getByRole('button', { name: 'Browse ivysaur cards' })).toBeVisible();
    await harness.expectNoHorizontalOverflow();
    await harness.expectHittable(harness.dock().getByRole('button', { name: 'Binder', exact: true }));
  });

  test('legacy saved payload is partial and cards without Pokémon remain browseable', async ({ harness }) => {
    await mockSet(harness.page, { ...payload, cards: undefined });
    await selectSet(harness);
    await harness.page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true })
      .click();
    await expect(harness.page.getByText(/Saved Pokémon cards only/)).toBeVisible();
    await expect(
      harness.page.getByRole('list', { name: 'Fixture Set card checklist' }).getByRole('listitem'),
    ).toHaveCount(1);
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await mockSet(harness.page, { ...payload, slots: [], cards: [trainer] });
    await selectSet(harness);
    await harness.page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true })
      .click();
    await expect(harness.page.getByText('Fixture Trainer', { exact: true })).toBeVisible();
  });

  test('read-only browsing retains exact state without collection mutations', async ({ harness }) => {
    const page = harness.page;
    await page.goto('/app/e2e-harness?signedIn=1&readOnly=1');
    await mockSet(page, {
      ...payload,
      cards: [{ ...card, id: 'base1-44' }, trainer],
      slots: [{ ...payload.slots[0], cards: [{ ...card, id: 'base1-44' }] }],
    });
    await selectSet(harness);
    await expect(page.getByText('Already have', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Want', exact: true })).toHaveCount(0);
    await page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true })
      .click();
    await expect(page.getByRole('listitem', { name: /Fixture Bulbasaur.*owned/ })).toBeVisible();
    await page.getByRole('button', { name: 'Browse bulbasaur cards', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Add |^Want / })).toHaveCount(0);
  });

  test('exact saved set data opens when the lookup fails', async ({ harness }) => {
    const page = harness.page;
    await mockSet(page);
    await selectSet(harness);
    // Give IndexedDB its asynchronous write, then remount Sets before disabling the endpoint.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const databases = await indexedDB.databases();
          return databases.some((database) => database.name === 'binderdex-offline');
        }),
      )
      .toBe(true);
    await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
    await page.route('**/app/api/tcg-set-slots**', (route) => route.abort());
    await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
    await page.getByRole('button', { name: 'Fixture Set', exact: true }).first().click();
    await expect(page.getByText('Showing saved set data on this device.')).toBeVisible();
    await page
      .getByRole('group', { name: 'Set checklist' })
      .getByRole('button', { name: 'Cards', exact: true })
      .click();
    await expect(page.getByText('Fixture Trainer', { exact: true })).toBeVisible();
  });

  test('selected sets show how much of the set the binder holds', async ({ harness }) => {
    const page = harness.page;
    await page.reload();
    await mockSet(page);
    await selectSet(harness);
    const completion = page.getByRole('list', { name: 'Set completion' });
    await expect(completion.getByRole('listitem')).toHaveCount(1);
    await expect(completion).toContainText('1/2 cards · 50%');
    const bar = completion.getByRole('progressbar', { name: 'Fixture Set completion' });
    await expect(bar).toHaveAttribute('aria-valuenow', '1');
    await expect(bar).toHaveAttribute('aria-valuemax', '2');
    await completion.scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await page.screenshot({ path: `/tmp/set-progress-${page.viewportSize()!.width}.png` });
  });
});
