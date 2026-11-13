import { test, expect } from './fixtures';
import type { Page, Route } from '@playwright/test';

// Synthetic harness only (app/e2e-harness/scan-destinations): synthetic cards, synthetic camera, synthetic OCR.
// Each pocket of a "page photo" is described as JSON, so every read is deterministic (no Tesseract, no network).
const review = (page: Page) => page.getByRole('dialog', { name: 'Scanned cards' });
const pocket = (page: Page, n: number) =>
  review(page).getByRole('region', { name: `Page 1 · Pocket ${n}`, exact: true });
const addButton = (page: Page) => review(page).getByRole('button', { name: /^(Add \d+ cards?|Choose a card to add)$/ });
const pending = (page: Page) => page.getByLabel('Pending scan count');
const control = (page: Page, mode: string) =>
  page.evaluate((mode) => window.dispatchEvent(new CustomEvent('synthetic-scan-control', { detail: mode })), mode);
/** Takes a synthetic page photo. `cells` is what each pocket's card reads as (index from the top left). */
const photo = async (page: Page, cells?: { index: number; text: string }[]) => {
  await page.getByRole('button', { name: 'Page scan', exact: true }).click();
  await page.getByLabel('Page photo', { exact: true }).setInputFiles({
    name: 'synthetic-page.png',
    mimeType: 'image/png',
    buffer: Buffer.from(cells ? JSON.stringify({ cells }) : 'synthetic'),
  });
};
// Synthetic catalog search: the harness's synthetic cards, matched on every word of the query.
const syntheticCards = [
  ['synthetic-snorlax-a', 'Snorlax A', [143]],
  ['synthetic-snorlax-b', 'Snorlax B', [143]],
  ['synthetic-trainer', 'Trainer', []],
  ['synthetic-tandemaus', 'Tandemaus', [924]],
  ['synthetic-maushold', 'Maushold', [925]],
  ['synthetic-multi', 'Pikachu and Snorlax', [25, 143]],
].map(([id, name, dexIds]) => ({
  id,
  name,
  dexIds,
  localId: '1',
  language: 'en',
  set: { id: 'synthetic', name: 'Synthetic set' },
  variants: { normal: true, holo: true },
}));
/** Opens the harness once its controls are listening. */
async function open(page: Page, query = '') {
  await page.goto(`/app/e2e-harness/scan-destinations${query}`);
  await expect(page.getByRole('button', { name: 'Page scan', exact: true })).toBeVisible();
}
async function mockSearch(page: Page) {
  const calls: URL[] = [];
  await page.route('**/app/api/tcg-card-search**', (route: Route) => {
    const url = new URL(route.request().url());
    calls.push(url);
    const ids = url.searchParams.get('ids')?.split(',');
    if (ids) return route.fulfill({ json: { cards: syntheticCards.filter((c) => ids.includes(c.id as string)) } });
    const words = (url.searchParams.get('q') ?? '').split(/\s+/).filter((w) => /^[a-z]{2,}$/.test(w));
    const cards = words.length
      ? syntheticCards.filter((c) => words.every((w) => (c.name as string).toLowerCase().includes(w)))
      : [];
    return route.fulfill({ json: { cards } });
  });
  return calls;
}

test.describe('page scan review, synthetic device only', () => {
  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    await page.addInitScript(() => {
      // Synthetic camera and single-card OCR, not a camera accuracy claim.
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
      const draw = () => {
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#123456';
        context.fillRect(0, 0, 640, 480);
      };
      draw();
      window.setInterval(draw, 100);
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: async () => canvas.captureStream(10) },
      });
      Object.assign(window, {
        TextDetector: class {
          async detect() {
            return [{ rawValue: 'Trainer Supporter Trainer 1/100' }];
          }
        },
      });
    });
  });

  test('a clear match is filled in, several are tap-to-pick, an unread pocket opens the picker searched, nothing saves until Add', async ({
    harness,
  }) => {
    const { page } = harness;
    const calls = await mockSearch(page);
    await open(page);
    await photo(page, [
      { index: 0, text: 'Snorlax' },
      { index: 2, text: 'Tandemaus 1/100' },
      { index: 3, text: 'Maushold' },
    ]);
    await expect(review(page)).toBeVisible();
    expect(calls.every((url) => url.searchParams.get('includeNonPokemon') === '1')).toBe(true);

    // One clear match: filled in, in the pocket it was photographed in, but not saved.
    await expect(pocket(page, 3)).toContainText('Tandemaus');
    await expect(pocket(page, 3)).toContainText('Goes in Page 1 · Pocket 3');
    await expect(addButton(page)).toHaveText('Add 1 card');
    await expect(pending(page)).toHaveText('0');

    // Several likely cards: tap one.
    const matches = pocket(page, 1).getByRole('group', { name: 'Possible matches' });
    await expect(matches.getByRole('button')).toHaveCount(3);
    await matches.getByRole('button', { name: 'Snorlax A, Synthetic set #1', exact: true }).click();
    await expect(pocket(page, 1)).toContainText('Goes in Page 1 · Pocket 1');
    await expect(pocket(page, 1).getByRole('group', { name: 'Which version?' })).toBeVisible();
    await expect(addButton(page)).toHaveText('Add 2 cards');

    // A name read with no sure match: left for you, and the picker opens already searched for it.
    await expect(pocket(page, 4)).toContainText('Which card is this?');
    await expect(pocket(page, 4).getByRole('group', { name: 'Possible matches' })).toHaveCount(0);
    await pocket(page, 4).getByRole('button', { name: 'Choose card', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Card selector' });
    await expect(picker.getByRole('searchbox', { name: 'Search cards' })).toHaveValue('Maushold');
    await picker.getByRole('button', { name: 'Add card Maushold from Synthetic set', exact: true }).click();
    await page.getByRole('dialog', { name: 'Which variant?' }).getByRole('button', { name: 'Add Normal' }).click();
    await expect(picker).toHaveCount(0);
    await expect(pocket(page, 4)).toContainText('Goes in Page 1 · Pocket 4');
    await expect(pending(page)).toHaveText('0');

    const dialog = review(page);
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectNoHorizontalOverflow();
    for (const name of ['Cancel', 'Add 3 cards', 'Close scan review']) {
      const button = dialog.getByRole('button', { name, exact: true });
      await harness.expectMinTapTarget(button, 36);
      await harness.expectHittable(button);
    }
    await dialog.getByRole('button', { name: 'Add 3 cards', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    // All three go in one save.
    await expect(pending(page)).toHaveText('1');
    for (const slot of ['slot-a', 'slot-c', 'slot-d']) await expect(page.getByText(`${slot}: empty`)).toHaveCount(0);
    await expect(page.getByText('slot-b: empty', { exact: true })).toBeVisible();
    await page.reload();
    await expect(pending(page)).toHaveText('1');
  });

  test('a confident picture match is pre-selected and can be skipped or changed, a close one still offers choices', async ({
    harness,
  }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page);
    // Text after `||` is the synthetic picture match list (cardId@similarity, best first).
    await photo(page, [
      { index: 0, text: '||synthetic-snorlax-a@0.84,synthetic-snorlax-b@0.79,synthetic-trainer@0.6' },
      { index: 2, text: '||synthetic-tandemaus@0.8,synthetic-maushold@0.79' },
      { index: 3, text: '||synthetic-maushold@0.85,synthetic-snorlax-b@0.7' },
    ]);
    await expect(review(page)).toBeVisible();

    // Sure and well ahead: pre-selected in the pocket it was photographed in, marked as from the photo, not saved.
    for (const [n, name] of [
      [1, 'Snorlax A'],
      [4, 'Maushold'],
    ] as const) {
      await expect(pocket(page, n)).toContainText(name);
      await expect(pocket(page, n)).toContainText('Matched from photo');
      await expect(pocket(page, n)).toContainText(`Goes in Page 1 · Pocket ${n}`);
    }
    // Too close to the runner-up: still a choice.
    await expect(pocket(page, 3)).toContainText('Which card is this?');
    await expect(pocket(page, 3).getByRole('group', { name: 'Possible matches' }).getByRole('button')).toHaveCount(2);
    await expect(addButton(page)).toHaveText('Add 2 cards');
    await expect(pending(page)).toHaveText('0');

    await pocket(page, 4).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(pocket(page, 4)).toContainText('Skipped');
    await expect(addButton(page)).toHaveText('Add 1 card');

    // Change card goes back to the other picture matches first.
    await pocket(page, 1).getByRole('button', { name: 'Change card', exact: true }).click();
    const matches = pocket(page, 1).getByRole('group', { name: 'Possible matches' });
    await expect(matches.getByRole('button')).toHaveCount(3);
    await expect(addButton(page)).toHaveText('Choose a card to add');
    await matches.getByRole('button', { name: 'Snorlax B, Synthetic set #1', exact: true }).click();
    await expect(pocket(page, 1)).toContainText('Snorlax B');
    await expect(pocket(page, 1)).not.toContainText('Matched from photo');
    await expect(addButton(page)).toHaveText('Add 1 card');

    await harness.expectNoHorizontalOverflow();
    await addButton(page).click();
    await expect(review(page)).toHaveCount(0);
    await expect(pending(page)).toHaveText('1');
    await expect(page.getByText('slot-a: empty', { exact: true })).toHaveCount(0);
    await expect(page.getByText('slot-d: empty', { exact: true })).toBeVisible();
  });

  test('a pocket that fails or never answers is left for you without holding up the others', async ({ harness }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page);
    await photo(page, [
      { index: 0, text: 'FAIL' },
      { index: 2, text: 'Tandemaus 1/100' },
      { index: 3, text: 'HANG' },
    ]);
    // The harness gives up on a silent pocket after 1.5 s (30 s in the app).
    await expect(review(page)).toBeVisible();
    await expect(pocket(page, 3)).toContainText('Tandemaus');
    for (const n of [1, 4]) {
      await expect(pocket(page, n)).toContainText('Which card is this?');
      await expect(pocket(page, n).getByRole('button', { name: 'Choose card', exact: true })).toBeEnabled();
    }
    await expect(addButton(page)).toHaveText('Add 1 card');
    await addButton(page).click();
    await expect(pending(page)).toHaveText('1');
    await expect(page.getByText('slot-a: empty', { exact: true })).toBeVisible();
    await expect(page.getByText('slot-d: empty', { exact: true })).toBeVisible();
  });

  test('cancel saves nothing, even with a card filled in', async ({ harness }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page);
    await photo(page, [{ index: 2, text: 'Tandemaus 1/100' }]);
    await expect(addButton(page)).toHaveText('Add 1 card');
    await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(review(page)).toHaveCount(0);
    await expect(pending(page)).toHaveText('0');
    await expect(page.getByText('slot-c: empty', { exact: true })).toBeVisible();
    await harness.expectScrollUnlocked();
  });

  for (const dismiss of ['escape', 'back', 'backdrop', 'swipe'] as const)
    test(`review dismissal by ${dismiss} never saves`, async ({ harness }) => {
      const { page } = harness;
      await mockSearch(page);
      await open(page);
      await photo(page, [{ index: 2, text: 'Tandemaus 1/100' }]);
      await expect(addButton(page)).toHaveText('Add 1 card');
      if (dismiss === 'escape') await page.keyboard.press('Escape');
      if (dismiss === 'back') await page.goBack();
      if (dismiss === 'backdrop') await harness.tapBackdrop(review(page));
      if (dismiss === 'swipe') await harness.swipeDown(review(page));
      await expect(review(page)).toHaveCount(0);
      await expect(pending(page)).toHaveText('0');
      await harness.expectScrollUnlocked();
    });

  test('a pocket holding a card is left alone until you choose to replace it', async ({ harness }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page, '?filled=1');
    await expect(page.getByText('slot-c: item-a', { exact: true })).toBeVisible();
    await photo(page, [{ index: 2, text: 'Snorlax' }]);
    await expect(pocket(page, 3)).toContainText('Already in your binder. Nothing to add.');
    await expect(addButton(page)).toHaveText('Choose a card to add');
    await expect(addButton(page)).toBeDisabled();

    // Replace, then change your mind: the pocket is left as it was.
    await pocket(page, 3).getByRole('button', { name: 'Wrong card? Replace it', exact: true }).click();
    await pocket(page, 3).getByRole('button', { name: 'Keep current card', exact: true }).click();
    await expect(pocket(page, 3)).toContainText('Already in your binder. Nothing to add.');

    await pocket(page, 3).getByRole('button', { name: 'Wrong card? Replace it', exact: true }).click();
    await expect(pocket(page, 3)).toContainText('Which card is this?');
    await pocket(page, 3).getByRole('button', { name: 'Choose card', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Card selector' });
    await picker.getByRole('searchbox', { name: 'Search cards' }).fill('Snorlax B');
    await picker.getByRole('button', { name: 'Add card Snorlax B from Synthetic set', exact: true }).click();
    await page.getByRole('dialog', { name: 'Which variant?' }).getByRole('button', { name: 'Add Normal' }).click();
    await expect(pocket(page, 3)).toContainText('Replaces the card in Page 1 · Pocket 3');
    await expect(page.getByText('slot-c: item-a', { exact: true })).toBeVisible();
    await addButton(page).click();
    await expect(review(page)).toHaveCount(0);
    await expect(pending(page)).toHaveText('1');
    await expect(page.getByText(/^slot-c: /)).not.toHaveText(/^slot-c: (item-a|empty)$/);
  });

  test('offline, pockets are matched against the cards saved on the device', async ({ harness }) => {
    const { page } = harness;
    const calls = await mockSearch(page);
    await open(page);
    await page.context().setOffline(true);
    await photo(page, [
      { index: 0, text: 'Snorlax' },
      { index: 2, text: 'Tandemaus 1/100' },
    ]);
    await expect(pocket(page, 3)).toContainText('Tandemaus');
    await expect(pocket(page, 1).getByRole('group', { name: 'Possible matches' }).getByRole('button')).toHaveCount(3);
    expect(calls).toHaveLength(0);
    await addButton(page).click();
    await expect(pending(page)).toHaveText('1');
    expect(calls).toHaveLength(0);
  });

  test('camera page capture goes through the same review and saves nothing by itself', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await page.getByRole('button', { name: 'Page scan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Take photo', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Take photo', exact: true }).click();
    await expect(review(page)).toBeVisible();
    // Pockets the detector found but couldn't read are never filled in.
    await expect(pocket(page, 1)).toContainText('Which card is this?');
    await expect(addButton(page)).toBeDisabled();
    await expect(pending(page)).toHaveText('0');
    await review(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(pending(page)).toHaveText('0');
  });

  test('card scan asks for non-Pokémon results and saves the lone match only on Add, without a second lookup', async ({
    harness,
  }) => {
    const { page } = harness;
    const calls = await mockSearch(page);
    // What the synthetic camera reads ("Trainer … 1/100") finds just the one synthetic Trainer.
    await page.route('**/app/api/tcg-card-search**', (route) => {
      calls.push(new URL(route.request().url()));
      return route.fulfill({ json: { cards: syntheticCards.filter((c) => c.id === 'synthetic-trainer') } });
    });
    await open(page);
    await control(page, 'online');
    await page.getByRole('button', { name: 'Card scan', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Read card', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Read card', exact: true }).click();
    const dialog = review(page);
    await expect(dialog.getByRole('region', { name: 'Scanned card' })).toContainText('Trainer');
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get('includeNonPokemon')).toBe('1');
    // The pocket kept for this card is offered, never saved without Add.
    await expect(dialog.getByRole('combobox', { name: 'Pocket for Trainer' })).toHaveValue('slot:slot-f');
    await expect(pending(page)).toHaveText('0');
    await addButton(page).click();
    await expect(pending(page)).toHaveText('1');
    await expect(page.getByText('slot-f: empty', { exact: true })).toHaveCount(0);
    expect(calls).toHaveLength(1);
  });

  for (const mode of ['reorder', 'grid', 'owner', 'session'])
    test(`a ${mode} change during review blocks Add`, async ({ harness }) => {
      const { page } = harness;
      await mockSearch(page);
      await open(page);
      await photo(page, [{ index: 2, text: 'Tandemaus 1/100' }]);
      await expect(addButton(page)).toBeEnabled();
      await control(page, mode);
      await expect(review(page).getByRole('alert')).toContainText('changed');
      await expect(addButton(page)).toBeDisabled();
      await expect(pending(page)).toHaveText('0');
    });

  test('a save that fails keeps the exact draft for Try again', async ({ harness }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page);
    await photo(page, [{ index: 2, text: 'Tandemaus 1/100' }]);
    await control(page, 'fail');
    await addButton(page).click();
    await expect(review(page).getByRole('alert')).toBeVisible();
    await expect(pending(page)).toHaveText('0');
    const attempt = await page.getByLabel('Scan attempts').textContent();
    await review(page).getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(pending(page)).toHaveText('1');
    await expect(page.getByLabel('Scan attempts')).toHaveText(`${attempt},${attempt}`);
    await expect(page.getByText('slot-c: empty', { exact: true })).toHaveCount(0);
  });

  test('closing while the page is read ignores late results', async ({ harness }) => {
    const { page } = harness;
    await open(page);
    await control(page, 'defer');
    await photo(page);
    await expect(page.getByRole('dialog', { name: 'Scan page' }).getByRole('status')).toContainText('Reading');
    await page.getByRole('button', { name: 'Close page scanner' }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-scan-release')));
    await expect(review(page)).toHaveCount(0);
    await expect(pending(page)).toHaveText('0');
    await harness.expectScrollUnlocked();
  });

  test('a layout change while the page is read cannot use the new pocket order', async ({ harness }) => {
    const { page } = harness;
    await mockSearch(page);
    await open(page);
    await control(page, 'defer');
    await photo(page, [{ index: 2, text: 'Tandemaus 1/100' }]);
    await expect(page.getByRole('dialog', { name: 'Scan page' }).getByRole('status')).toContainText('Reading');
    await control(page, 'reorder');
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-scan-release')));
    await expect(review(page).getByRole('alert')).toContainText('changed');
    await expect(addButton(page)).toBeDisabled();
    await expect(pending(page)).toHaveText('0');
  });
});

test('scanner harness requires a loopback request hostname', async ({ request }) => {
  const local = await request.get('/app/e2e-harness/scan-destinations');
  expect(local.status()).toBe(200);
  const remote = await request.get('/app/e2e-harness/scan-destinations', {
    headers: { Host: 'synthetic-remote.example' },
  });
  const denied = await remote.text();
  expect(denied).not.toContain('Synthetic scan destinations');
  // The static Suspense shell has streamed before request-time notFound resolves.
  expect(denied).toContain('NEXT_HTTP_ERROR_FALLBACK;404');
  expect(denied).toContain('noindex');
});
