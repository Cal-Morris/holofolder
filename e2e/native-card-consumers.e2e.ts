import { test, expect, mockBackends, emulateStandalone, Harness } from './fixtures';
import { inventoryProjectionCatalog } from '../tests/fixtures/inventory-browse';

test.beforeEach(async ({ page, context, standalone, insets, baseURL }) => {
  if (standalone) await emulateStandalone(page, insets);
  await mockBackends(page, context, { signedIn: false, baseURL });
  const cards = inventoryProjectionCatalog.map((c) => ({
    ...c.card,
    dexIds: [...(c.pokemonIds ?? [])],
    variants: { normal: true },
  }));
  await page.route('**/app/api/tcgdex-cache**', (route) =>
    route.fulfill({
      json: {
        cards: cards.filter((c) =>
          c.dexIds.includes(Number(new URL(route.request().url()).searchParams.get('pokemonId'))),
        ),
      },
    }),
  );
  await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards } }));
});
const entry = '/app/e2e-harness/native-card-consumers';
// Internal ids, storage evidence and staging copy must never reach the screen.
const raw =
  /explicit entries|Saved storage evidence|physical cop|Unknown exact printing|wanted entry|Use this wanted destination|Add a new raw copy|Draft handed|Native editing|alpha-empty|copy-0000/;
// Actual QuickMode/ShowHunt, browser, Search and deal-check components. Read/admission/sink synthetic.

test('actual card browser badges count copies while native details use explicit destinations', async ({
  page,
  insets,
}) => {
  await page.goto(`${entry}?mode=browser`);
  const browser = page.getByRole('dialog');
  await expect(browser.getByRole('listitem', { name: /Synthetic Snorlax.*Owned ×3/ })).toBeVisible();
  await expect(browser.getByRole('button', { name: /^Want |^Add .*to binder/ })).toHaveCount(0);
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
  await page.goto(`${entry}?mode=details`);
  await expect(page.getByRole('heading', { name: 'Synthetic Trainer', exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('listitem', { name: /Synthetic Trainer.*Owned ×1 · Wanted ×3/ }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('Snorlax');
  await expect(
    page
      .getByRole('region', { name: 'On your want list' })
      .getByRole('heading', { name: 'On your want list · 3 cards' }),
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'On your want list' })).not.toContainText(raw);
  await expect(page.getByRole('button', { name: 'Jump to binder slot' })).toHaveCount(0);
  await expect(page.getByLabel('Synthetic legacy writes')).toHaveText('0');
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
});

test('actual Search and Quick search show simultaneous distinct-copy/wanted badges', async ({ page, insets }) => {
  await page.goto(`${entry}?mode=search`);
  await page.getByRole('textbox').first().fill('Synthetic');
  await expect(page.getByRole('button', { name: /Synthetic Trainer.*Owned ×1 · Wanted ×3/ })).toBeVisible();
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
  await page.goto(entry);
  await page.getByRole('searchbox', { name: 'Search cards, Pokémon, sets and pages' }).fill('Synthetic Trainer');
  await expect(page.getByRole('button', { name: /Synthetic Trainer.*Owned ×1 · Wanted ×3/ })).toBeVisible();
  await expect(page.getByLabel('Synthetic legacy writes')).toHaveText('0');
});

async function addNativePrinting(page: import('@playwright/test').Page, name: string, quantity = 1) {
  await page.getByRole('searchbox').fill(name);
  await page
    .getByRole('region', { name: 'Cards', exact: true })
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click();
  const check = page.getByTestId('quick-card-check');
  await expect(check).toBeVisible();
  for (let i = 0; i < quantity; i++) await check.getByRole('button', { name: 'Add to bundle', exact: true }).click();
  await check.getByRole('button', { name: 'Back to results' }).click();
}

async function nativeBundlePrices(page: import('@playwright/test').Page) {
  const { mockCardPrices } = await import('./price-fixtures');
  // Synthetic exact-finish saved catalogue prices. Headline-only Energy is deliberately unknown.
  await mockCardPrices(page, {
    'synthetic-trainer': { market: 3, confidence: 'high', finishes: [{ finish: 'normal', market: 3 }] },
    'synthetic-snorlax': { market: 10, confidence: 'high', finishes: [{ finish: 'normal', market: 10 }] },
    'synthetic-energy': { market: 99, confidence: 'high' },
  });
}

for (const priceCase of ['unknown-language', 'unsupported-finish'])
  test(`native ${priceCase} cannot borrow saved English any-finish sold evidence`, async ({ page }) => {
    await nativeBundlePrices(page);
    let reads = 0;
    await page.route('**/app/api/card-price-checks**', (route) => {
      reads++;
      const check = {
        checkedAt: new Date().toISOString(),
        summary: { kind: 'sold', currency: 'GBP', count: 12, low: 100, median: 100, high: 100 },
        sales: Array.from({ length: 12 }, (_, i) => ({
          amount: 100,
          soldAt: new Date(Date.now() - ((i % 3) + 1) * 86400000).toISOString().slice(0, 10),
        })),
      };
      return route.fulfill({ json: { ebay: null, soldcomps: check, errors: {} } });
    });
    await page.goto(`${entry}?mode=check&priceCase=${priceCase}`);
    const check = page.getByTestId('quick-card-check');
    await expect(check).toBeVisible();
    await check.getByRole('textbox').fill('70');
    await expect(check.getByTestId('quick-card-market-price')).not.toContainText('£100');
    await expect(check.getByTestId('quick-pay-up-to')).toHaveText('Unknown');
    await expect(check.getByTestId('deal-verdict')).not.toHaveAttribute(
      'data-verdict',
      /great|good|fair|overpriced|walk-away/,
    );
    expect(reads).toBe(0);
  });

test('native bundle rechecks retained catalogue age after a long offline visit', async ({ page }) => {
  await nativeBundlePrices(page);
  await page.goto(entry);
  await addNativePrinting(page, 'Synthetic Trainer');
  await page.getByRole('button', { name: /Check bundle/ }).click();
  const bundle = page.getByTestId('quick-bundle');
  await expect(bundle.getByTestId('bundle-market-total')).toContainText('£3.00');
  await bundle.getByRole('textbox', { name: /Bundle price/ }).fill('2');
  await expect(bundle.getByTestId('bundle-verdict')).toHaveAttribute('data-verdict', 'great');
  await page.evaluate(() => {
    const future = Date.now() + 40 * 86400000;
    Date.now = () => future;
    dispatchEvent(new Event('focus'));
  });
  await expect(bundle.getByTestId('bundle-market-total')).toContainText('1 unpriced');
  await expect(bundle.getByTestId('bundle-verdict')).not.toHaveAttribute(
    'data-verdict',
    /great|good|fair|overpriced|walk-away/,
  );
});

test('native bundle compares repeated exact printings, removes one entry, and stays cached/offline read-only', async ({
  page,
  context,
  insets,
}) => {
  await nativeBundlePrices(page);
  const writes: string[] = [];
  page.on('request', (r) => {
    if (
      r.method() !== 'GET' &&
      /\/api\/(card-price-checks|comparison-jobs|show-purchases|inventory|collection|card-prices)(?:[/?]|$)/.test(
        r.url(),
      )
    )
      writes.push(r.url());
  });
  await page.goto(`${entry}?cached=1&selected=1`);
  await addNativePrinting(page, 'Synthetic Trainer', 2);
  await page.getByRole('button', { name: /Check bundle/ }).click();
  const bundle = page.getByTestId('quick-bundle');
  const items = bundle.getByRole('list', { name: 'Cards in bundle' }).getByRole('listitem');
  await expect(items).toHaveCount(2);
  await expect(bundle).toContainText('Cached only, read-only');
  await expect(items.first()).toContainText('Wanted ×3');
  await expect(items.first()).not.toContainText('Owned');
  await expect(bundle.getByTestId('bundle-market-total')).toContainText('£6.00');
  const input = bundle.getByRole('textbox', { name: /Bundle price/ });
  await input.fill('5');
  await input.press('Enter');
  await expect(bundle.getByTestId('bundle-verdict')).toHaveAttribute('data-verdict', 'good');
  const h = new Harness(page, insets, false);
  await h.expectNoHorizontalOverflow();
  await h.expectMinTapTarget(input.locator('..'));
  const remove = bundle.getByRole('button', { name: 'Remove Synthetic Trainer from bundle' }).first();
  await h.expectMinTapTarget(remove);
  await remove.scrollIntoViewIfNeeded();
  await h.expectWithinSafeViewport(remove);
  await h.expectHittable(remove);
  await remove.click();
  await expect(items).toHaveCount(1);
  await expect(bundle.getByTestId('bundle-market-total')).toContainText('£3.00');
  // The actual checker and bundle code are already loaded before network disconnection.
  await bundle.getByRole('button', { name: 'Back to results' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: /Check bundle/ }).click();
  await expect(bundle).toContainText('Cached only, read-only');
  await expect(items).toHaveCount(1);
  await expect(bundle.getByRole('button', { name: /Bought|Check bundle prices|Unlock|Replace/ })).toHaveCount(0);
  await expect(bundle.getByRole('region', { name: 'Bundle destination' })).toHaveCount(0);
  await bundle.getByRole('button', { name: 'Clear bundle' }).click();
  await expect(bundle.getByRole('button', { name: 'Remove Synthetic Trainer from bundle' })).toHaveCount(0);
  await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
  await expect(page.getByLabel('Synthetic legacy writes')).toHaveText('0');
  expect(writes).toEqual([]);
  expect(await page.evaluate(() => sessionStorage.getItem('binderdex:show-bundle:v1'))).toBeNull();
  await h.expectNoHorizontalOverflow();
});

test('native bundle refuses mixed currencies and missing exact-finish evidence', async ({ page, insets }) => {
  await nativeBundlePrices(page);
  await page.goto(entry);
  await addNativePrinting(page, 'Synthetic Trainer');
  // Currency is a real preference change while the first selected reference stays in GBP.
  await page.getByRole('button', { name: 'Toggle currency' }).evaluate((el: HTMLButtonElement) => el.click());
  await addNativePrinting(page, 'Synthetic Snorlax');
  await addNativePrinting(page, 'Synthetic Energy');
  await page.getByRole('button', { name: /Check bundle/ }).click();
  const bundle = page.getByTestId('quick-bundle');
  await expect(bundle.getByRole('listitem')).toHaveCount(3);
  await expect(bundle.getByTestId('bundle-market-total')).toContainText('2 unpriced');
  await bundle.getByRole('textbox', { name: /Bundle price/ }).fill('5');
  await expect(bundle.getByTestId('bundle-verdict')).not.toHaveAttribute(
    'data-verdict',
    /great|good|fair|overpriced|walk-away/,
  );
  await expect(bundle).toContainText('Incomplete price evidence');
  await expect(bundle.getByRole('listitem').filter({ hasText: 'Synthetic Energy' })).toContainText('Owned ×1');
  await expect(bundle.getByRole('listitem').filter({ hasText: 'Synthetic Snorlax' })).toContainText('Owned ×3');
  await page.getByRole('button', { name: 'Toggle scope' }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(bundle.getByRole('listitem').filter({ hasText: 'Synthetic Energy' })).toContainText(
    'No exact saved match',
  );
  await expect(bundle.getByRole('listitem').filter({ hasText: 'Synthetic Snorlax' })).toContainText('Owned ×1');
  await new Harness(page, insets, false).expectNoHorizontalOverflow();
});

for (const dismissal of ['close', 'escape', 'back', 'backdrop', 'swipe'] as const)
  test(`native bundle uses existing Quick mode ${dismissal} dismissal`, async ({ page, insets }) => {
    await nativeBundlePrices(page);
    await page.goto(entry);
    await addNativePrinting(page, 'Synthetic Trainer');
    await page.getByRole('button', { name: /Check bundle/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick mode' });
    await expect(page.getByTestId('quick-bundle')).toBeVisible();
    const h = new Harness(page, insets, false);
    if (dismissal === 'close') {
      const close = dialog.getByRole('button', { name: 'Close quick mode' });
      await h.expectMinTapTarget(close);
      await h.expectWithinSafeViewport(close);
      await h.expectHittable(close);
      await close.click();
    } else if (dismissal === 'escape') await page.keyboard.press('Escape');
    else if (dismissal === 'back') await page.goBack();
    // Quick mode fills the phone viewport, so its backdrop has no exposed touch area.
    else if (dismissal === 'backdrop') await page.locator('[data-overlay-backdrop]').dispatchEvent('click');
    else await h.swipeDown(dialog);
    await expect(dialog).toHaveCount(0);
    await h.expectScrollUnlocked();
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
  });
