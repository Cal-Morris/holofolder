import type { Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import {
  test,
  expect,
  mockBackends,
  seedNativeStorage,
  Harness,
  openSettingsPage,
  openStorage,
  appendPocket,
  collectionPicker,
  SEEDED_COLLECTION,
  E2E_USER,
  type SeedRow,
} from './fixtures';
import { mockCardPrices, requestedPriceCards } from './price-fixtures';
import { HUNT_COLLECTION, HUNT_PRICES } from './hunt-fixtures';
import { WANTED_COLLECTION } from './wanted-fixtures';
import { slimSetSlotsResponse, type TCGSetSlotsResponse } from '../lib/tcg-set-slots';

// Help centre screenshots (content/help/images), not a test: `bun run help:screenshots`.
// Synthetic account and storage as in the rest of the suite, but with the real card art from our public CDN.
test.skip(process.env.HELP_SCREENSHOTS !== '1', 'Run with `bun run help:screenshots`');

const HARNESS = '/app/e2e-harness?signedIn=1&browserHost=1&cardArtwork=1';
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

/** Lets card images and Pokémon artwork load the real public files instead of the suite's placeholders. */
async function realArt(page: Page) {
  await page.route(/^https:\/\/(assets\.holofolder\.com|raw\.githubusercontent\.com)\//, (route) => route.continue());
  await page.route('**/app/api/card-image-proxy**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const key = params.get('key');
    const target = key ? `https://assets.holofolder.com/${key}` : params.get('url');
    if (!target) return route.abort();
    return route.fulfill({ response: await route.fetch({ url: target }) });
  });
}

/** Real printings only: some MOCK_CARDS ids carry another card's art on the CDN. */
const REAL_CARDS = [
  [1, 'Bulbasaur', 'base1', 'Base Set', '44', 102],
  [1, 'Bulbasaur', 'sv03.5', '151', '001', 165],
  [1, 'Bulbasaur', 'sv03.5', '151', '166', 165],
  [2, 'Ivysaur', 'base1', 'Base Set', '30', 102],
  [2, 'Ivysaur', 'sv03.5', '151', '002', 165],
  [4, 'Charmander', 'base1', 'Base Set', '46', 102],
  [4, 'Charmander', 'sv03.5', '151', '004', 165],
  [4, 'Charmander', 'sv03.5', '151', '168', 165],
  [5, 'Charmeleon', 'sv03.5', '151', '005', 165],
  [6, 'Charizard ex', 'sv03.5', '151', '006', 165],
  [7, 'Squirtle', 'base1', 'Base Set', '63', 102],
  [7, 'Squirtle', 'sv03.5', '151', '007', 165],
  [7, 'Squirtle', 'sv03.5', '151', '170', 165],
].map(([dexId, name, setId, setName, localId, total]) => ({
  id: `${setId}-${localId}`,
  localId: String(localId),
  name: String(name),
  image: `https://assets.holofolder.com/pokemon/tcg/cards/en/${setId}/${localId}/high.webp`,
  set: {
    id: String(setId),
    name: String(setName),
    officialCardCount: Number(total),
    releaseDate: setId === 'base1' ? '1999-01-09' : '2023-09-22',
  },
  rarity:
    Number(localId) > Number(total) ? 'Illustration Rare' : String(name).endsWith(' ex') ? 'Double Rare' : 'Common',
  // Illustration rares and ex cards are holo only.
  variants:
    Number(localId) > Number(total) || String(name).endsWith(' ex')
      ? { holo: true }
      : { normal: true, reverse: setId !== 'base1' },
  dexIds: [Number(dexId)],
  language: 'en',
}));

/** Signed-in harness backends over synthetic native storage, with real art and real printings. */
async function prepare(page: Page, baseURL: string | undefined, collection: SeedRow[] = SEEDED_COLLECTION) {
  await mockBackends(page, page.context(), { signedIn: true, baseURL });
  await seedNativeStorage(page.context(), baseURL, collection);
  await realArt(page);
  await page.route('**/app/api/cards/pokemon**', (route) => {
    const dexId = Number(new URL(route.request().url()).searchParams.get('dexId'));
    return route.fulfill({ json: { cards: REAL_CARDS.filter((card) => card.dexIds.includes(dexId)) } });
  });
  await page.route('**/app/api/tcg-card-search**', (route) => {
    const params = new URL(route.request().url()).searchParams;
    const ids = params.get('ids')?.split(',');
    const query = (params.get('q') ?? '').toLowerCase().trim();
    const cards = ids
      ? REAL_CARDS.filter((card) => ids.includes(card.id))
      : REAL_CARDS.filter((card) => `${card.name} ${card.set.name} ${card.id}`.toLowerCase().includes(query));
    return route.fulfill({ json: { cards } });
  });
}

async function open(page: Page, path = HARNESS) {
  await page.goto(path);
  const harness = new Harness(page, NO_INSETS, true);
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
  return harness;
}

async function start(page: Page, baseURL: string | undefined, collection: SeedRow[] = SEEDED_COLLECTION) {
  await prepare(page, baseURL, collection);
  return open(page);
}

/** Synthetic round prices for every card (£8 low, £10 market, £12 high; $10, $12.50 and $15 at the quoted USD rate), not real market data. */
async function roundPrices(page: Page) {
  await page.route('**/app/api/card-prices**', (route) => {
    const updatedAt = new Date(Date.now() - 3_600_000).toISOString();
    return route.fulfill({
      json: {
        prices: requestedPriceCards(route.request()).map(({ cardId, language }) => ({
          cardId,
          language: language ?? 'en',
          historyPoints: [],
          gbpAmount: 10,
          marketGbpAmount: 10,
          goodGbpAmount: 8,
          lowGbpAmount: 8,
          highGbpAmount: 12,
          confidence: 'high',
          sourcePrices: [
            {
              source: 'tcgplayer',
              label: 'TCGplayer',
              variantLabel: 'Normal',
              marketGbpAmount: 10,
              lowGbpAmount: 8,
              originalMarketAmount: 12.5,
              originalLowAmount: 10,
              originalCurrency: 'USD',
              updatedAt,
            },
            {
              source: 'cardmarket',
              label: 'Cardmarket',
              variantLabel: 'Trend',
              marketGbpAmount: 10,
              lowGbpAmount: 8,
              originalMarketAmount: 12,
              originalLowAmount: 9,
              originalCurrency: 'EUR',
              updatedAt,
            },
          ],
          trendPoints: [],
          buySignal: null,
          originalAmount: 12.5,
          originalCurrency: 'USD',
          source: 'tcgplayer',
          variantLabel: 'Normal',
          updatedAt,
          fxDate: null,
          fetchedAt: Date.now(),
          finishPrices: [
            {
              cardId,
              language: language ?? 'en',
              finish: 'normal',
              variantKey: 'normal',
              variantLabel: 'normal',
              marketGbpAmount: 10,
              gbpAmount: 10,
              goodGbpAmount: 8,
              lowGbpAmount: 8,
              highGbpAmount: 12,
              confidence: 'high',
              source: 'tcgplayer',
              sourcePrices: [],
              updatedAt,
              fxDate: null,
              trendPoints: [],
            },
          ],
        })),
      },
    });
  });
}

async function toBinder(harness: Harness) {
  await harness.dock().getByRole('button', { name: 'Binder', exact: true }).click();
  await expect(harness.slot(1)).toBeVisible({ timeout: 15_000 });
}

type Clip = { x: number; y: number; width: number; height: number };

/** The area of an element plus some padding, for a cropped shot. */
async function around(locator: Locator, padding = 12): Promise<Clip> {
  const box = (await locator.boundingBox())!;
  return { x: box.x - padding, y: box.y - padding, width: box.width + padding * 2, height: box.height + padding * 2 };
}

/** Waits until every on-screen image has loaded, then saves the viewport (or `clip`) as a 780 px wide WebP. */
async function shoot(page: Page, name: string, clip?: Clip) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          [...document.images]
            .filter((img) => {
              const box = img.getBoundingClientRect();
              return (
                box.width > 0 &&
                box.bottom > 0 &&
                box.top < innerHeight &&
                getComputedStyle(img).visibility !== 'hidden'
              );
            })
            .filter((img) => !img.complete || img.naturalWidth === 0)
            .map((img) => img.currentSrc || img.src),
        ),
      { timeout: 20_000, message: `images still loading or broken in ${name}` },
    )
    .toEqual([]);
  await page.waitForTimeout(600);
  const png = await page.screenshot({ animations: 'disabled', caret: 'hide', clip });
  await sharp(png).resize({ width: 780 }).webp({ quality: 78 }).toFile(`content/help/images/${name}.webp`);
}

async function openMore(page: Page, item: string) {
  await page.getByTestId('app-header').getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function openSettings(page: Page) {
  await openMore(page, 'Settings');
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();
  return settings;
}

test.describe('help centre screenshots', () => {
  test.describe.configure({ timeout: 90_000 });

  test('getting started', async ({ page, baseURL }) => {
    const harness = await start(page, baseURL);
    await toBinder(harness);
    await shoot(page, 'getting-started-binder-page');

    await collectionPicker(page).click();
    await page.getByRole('dialog', { name: 'Choose collection' }).getByText('New binder', { exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New binder', exact: true });
    await expect(wizard.getByRole('group', { name: 'What is this binder for?' })).toBeVisible();
    await shoot(page, 'getting-started-wizard-kind');
  });

  test('adding and scanning cards', async ({ page, baseURL }) => {
    await prepare(page, baseURL);
    await roundPrices(page);
    const harness = await open(page);
    await toBinder(harness);
    await harness.slot(2).click();
    const selector = page.getByRole('dialog', { name: /card selector/i });
    await expect(selector.getByRole('button', { name: /filters · sort/i })).toBeVisible();
    await expect(selector.getByRole('button', { name: 'Scan card', exact: true })).toBeVisible();
    await expect(selector.getByRole('button', { name: /^Add card Ivysaur from / }).first()).toBeVisible();
    await shoot(page, 'adding-cards-picker');
    await harness.closeControl(selector).click();
    await expect(selector).toHaveCount(0);

    const detail = await harness.openCardDetail();
    await expect(detail.getByRole('button', { name: 'More card options' })).toBeVisible();
    // Also the Prices article's shot: the sheet's Prices section with Low, Market, range and confidence.
    await expect(detail.getByRole('region', { name: 'Prices' }).getByText(/high confidence/i)).toBeVisible();
    await shoot(page, 'adding-cards-details');
  });

  test('want list', async ({ page, baseURL }) => {
    await prepare(page, baseURL, WANTED_COLLECTION);
    // Synthetic round prices, not real market values.
    await mockCardPrices(page, {
      'sv03.5-166': { confidence: 'high', market: 20, finish: 'holo' },
      'sv03.5-168': { confidence: 'high', market: 30, finish: 'holo' },
      'sv03.5-005': { confidence: 'high', market: 1, finish: 'normal' },
      'sv03.5-006': { confidence: 'high', market: 10, finish: 'holo' },
      'sv03.5-007': { confidence: 'high', market: 1, finish: 'normal' },
    });
    const harness = await open(page);
    await harness.dock().getByRole('button', { name: 'Wanted', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Wanted', exact: true })).toBeVisible();
    await shoot(page, 'want-list-wanted-tab');
  });

  test('multiple binders', async ({ page, baseURL }) => {
    const harness = await start(page, baseURL);
    await toBinder(harness);
    const home = await collectionPicker(page).getAttribute('data-value');
    // A second binder, made with the wizard.
    await (await openStorage(page)).getByRole('button', { name: 'New binder', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New binder', exact: true });
    await wizard
      .getByRole('group', { name: 'What is this binder for?' })
      .getByRole('button', { name: /^Blank/ })
      .click();
    const name = wizard.getByRole('textbox', { name: 'Binder name' });
    for (let i = 0; i < 4 && !(await name.isVisible()); i++)
      await wizard.getByRole('button', { name: 'Next', exact: true }).click();
    await name.fill('Trades');
    await wizard.getByRole('button', { name: 'Preview', exact: true }).click();
    await wizard.getByRole('button', { name: 'Create binder', exact: true }).click();
    await expect(collectionPicker(page)).not.toHaveAttribute('data-value', home!);
    await expect(wizard).toHaveCount(0, { timeout: 15_000 });

    await collectionPicker(page).click();
    const menu = page.getByRole('dialog', { name: 'Choose collection', exact: true });
    await menu.locator(`[role="menuitemradio"][data-value="${home}"]`).click();
    await expect(collectionPicker(page)).toHaveAttribute('data-value', home!);
    await expect(harness.slot(1)).toBeVisible();
    await collectionPicker(page).click();
    await expect(menu).toBeVisible();
    await shoot(page, 'multiple-binders-switch');
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);

    await (await openStorage(page)).getByRole('button', { name: 'Delete this binder', exact: true }).click();
    const confirm = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Keep it' }) });
    await expect(confirm).toBeVisible();
    await shoot(page, 'multiple-binders-delete');
  });

  test('browsing a set', async ({ page, baseURL }) => {
    // Owns the 151 Bulbasaur and Charmander, so the set shows some progress.
    await prepare(page, baseURL, [
      { ...SEEDED_COLLECTION[0], card_id: 'sv03.5-001' },
      { ...SEEDED_COLLECTION[1], card_id: 'sv03.5-004' },
    ]);
    const set = { id: 'sv03.5', name: '151', officialCardCount: 165, releaseDate: '2023-09-22' };
    const kanto = [
      'Bulbasaur',
      'Ivysaur',
      'Venusaur ex',
      'Charmander',
      'Charmeleon',
      'Charizard ex',
      'Squirtle',
      'Wartortle',
      'Blastoise ex',
      'Caterpie',
      'Metapod',
      'Butterfree',
    ];
    const cards = kanto.map((name, i) => {
      const localId = String(i + 1).padStart(3, '0');
      return {
        id: `sv03.5-${localId}`,
        localId,
        name,
        image: `https://assets.holofolder.com/pokemon/tcg/cards/en/sv03.5/${localId}/high.webp`,
        language: 'en' as const,
        set,
        inferredFinish: name.endsWith(' ex') ? ('holo' as const) : ('normal' as const),
      };
    });
    const payload: TCGSetSlotsResponse = {
      sets: [set],
      selectedSet: set,
      cards,
      slots: kanto.map((name, i) => ({
        dexId: i + 1,
        pokemonName: name.replace(/ ex$/, '').toLowerCase(),
        cards: [cards[i]],
      })),
    };
    await page.route('**/app/api/tcg-set-slots**', (route) =>
      route.fulfill({
        json: new URL(route.request().url()).searchParams.has('setId')
          ? slimSetSlotsResponse(payload)
          : { sets: [set], selectedSet: null, slots: [] },
      }),
    );
    // Synthetic modest round prices so Top value has something to rank; not real market data.
    await mockCardPrices(
      page,
      Object.fromEntries(
        cards.map((card) => [
          card.id,
          card.name.endsWith(' ex')
            ? { confidence: 'high' as const, market: 5, finish: 'holo' as const }
            : { confidence: 'high' as const, market: 1, finish: 'normal' as const },
        ]),
      ),
    );
    const harness = await open(page);
    await harness.dock().getByRole('button', { name: 'Browse', exact: true }).click();
    await page.getByRole('textbox', { name: 'Search sets by name, code or year' }).fill('151');
    await page.getByRole('button', { name: /151/ }).first().click();
    const checklist = page.getByRole('group', { name: 'Set checklist' });
    await expect(checklist).toBeVisible();
    await expect(page.getByText(/Top value/).first()).toBeVisible();
    await page
      .getByText(/2\/12 cards/)
      .first()
      .evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
        document.querySelector('[data-testid="view-scroller"]')?.scrollBy(0, -10);
      });
    await shoot(page, 'browsing-cards-set');
  });

  test('search', async ({ page, baseURL }) => {
    const harness = await start(page, baseURL);
    await harness.dock().getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('dialog', { name: /search/i });
    await search.getByRole('textbox').fill('Charmander');
    await expect(search.getByText('Charmander').first()).toBeVisible();
    await shoot(page, 'browsing-cards-search');
  });

  test('scanning from the storage menu and offline settings', async ({ page, baseURL }) => {
    const harness = await start(page, baseURL);
    await toBinder(harness);
    const storage = await openStorage(page);
    await expect(storage.getByRole('button', { name: 'Scan page', exact: true })).toBeVisible();
    await expect(storage.getByRole('button', { name: 'Scan card', exact: true })).toBeVisible();
    await shoot(page, 'scanning-storage-menu');
    await page.keyboard.press('Escape');
    await expect(storage).toHaveCount(0);

    const settings = await openSettings(page);
    await openSettingsPage(settings, 'Offline & app');
    // From the Browser mode card down to the install hint, ending before Offline sets.
    const sheet = (await settings.boundingBox())!;
    const top = (await settings.getByText('Browser mode', { exact: true }).boundingBox())!.y - 32;
    const hint = (await settings.getByText(/does not show an install prompt/).boundingBox())!;
    await shoot(page, 'offline-and-install-settings', {
      x: sheet.x,
      y: top,
      width: sheet.width,
      height: hint.y + hint.height + 16 - top,
    });
    const scanner = settings.getByRole('region', { name: 'Picture scanner' });
    await expect(scanner.getByRole('switch', { name: 'Download scanner for offline' })).toBeEnabled();
    await scanner.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    await shoot(page, 'scanning-offline-scanner', await around(scanner));
  });

  test('show mode', async ({ page, baseURL }) => {
    // The suite's hunt list, with a real 151 Bulbasaur in place of the mock Phantasmal Flames one.
    const collection = structuredClone(HUNT_COLLECTION);
    Object.assign(collection[0].wanted_cards[1], {
      card_id: 'sv03.5-001',
      card_set: '151',
      local_id: '001',
      set_total: 165,
      card_image: 'https://assets.holofolder.com/pokemon/tcg/cards/en/sv03.5/001/high.webp',
    });
    await prepare(page, baseURL, collection);
    await mockCardPrices(page, HUNT_PRICES);
    await open(page);
    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const hunt = page.getByRole('dialog', { name: 'Quick mode' }).getByTestId('show-hunt');
    await expect(hunt.getByRole('heading', { name: /Hunting · 4 cards/ })).toBeVisible();
    await expect(hunt.getByTestId('hunt-pay-up-to').first()).toBeVisible();
    await hunt.getByRole('region', { name: 'Hunting Bulbasaur' }).evaluate((element) => {
      // The group's heading just below the sticky Hunting filters.
      element.scrollIntoView({ block: 'start' });
      let scroller = element.parentElement;
      while (scroller && scroller.scrollHeight <= scroller.clientHeight) scroller = scroller.parentElement;
      scroller?.scrollBy(0, -110);
    });
    await shoot(page, 'show-mode-hunting');
  });

  test('show mode deal verdict', async ({ page, baseURL }) => {
    await prepare(page, baseURL);
    // Synthetic: a high-confidence market price of £10 for the holo.
    await mockCardPrices(page, { 'sv03.5-006': { finish: 'holo', market: 10, confidence: 'high' } });
    await open(page);
    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Quick mode' });
    await dialog.getByRole('searchbox').fill('charizard');
    await dialog
      .getByRole('region', { name: 'Cards' })
      .getByRole('button', { name: /^Charizard ex, 151 / })
      .first()
      .click();
    const check = dialog.getByTestId('quick-card-check');
    const input = check.getByRole('textbox', { name: 'Asking price' });
    await input.fill('7');
    await input.press('Enter');
    await expect(check.getByTestId('deal-verdict')).toContainText('Great deal');
    await input.blur();
    await shoot(page, 'show-mode-deal-verdict');
  });

  test('prices settings', async ({ page, baseURL }) => {
    await start(page, baseURL);
    const settings = await openSettings(page);
    await openSettingsPage(settings, 'Prices');
    await shoot(page, 'prices-settings');
  });

  test('settings overview', async ({ page, baseURL }) => {
    await start(page, baseURL);
    await openSettings(page);
    await shoot(page, 'settings-overview');
  });

  test('sharing', async ({ page, baseURL }) => {
    await prepare(page, baseURL);
    let share: { token: string; is_enabled: boolean; show_prices: boolean } | null = null;
    let slug: string | null = null;
    // In-memory share and binder address, like e2e/native-owner-share.e2e.ts.
    await page.route('**/app/api/binder-share**', async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        const body = route.request().postDataJSON() as { showPrices?: boolean };
        share = { token: 'k3x9q2', is_enabled: true, show_prices: body.showPrices ?? share?.show_prices ?? false };
      }
      if (method === 'DELETE' && share) share = { ...share, is_enabled: false };
      return route.fulfill({
        json: { share: share ? { ...share, path: slug ? `/@ash/${slug}` : `/app/share/${share.token}` } : null },
      });
    });
    await page.route('**/app/api/binder-identity**', async (route) => {
      if (route.request().method() === 'PATCH') slug = (route.request().postDataJSON() as { slug: string }).slug;
      return route.fulfill({ json: { username: 'ash', slug, canEdit: true, available: true } });
    });
    const harness = await open(page);
    await toBinder(harness);
    await openMore(page, 'Create share link');
    await expect(page.locator('[data-toaster]')).toHaveText('Read-only share link is live');
    const settings = await openSettings(page);
    await openSettingsPage(settings, 'Sharing');
    const field = settings.getByLabel('Binder slug');
    await expect(field).toBeEnabled();
    await field.fill('national');
    await settings.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(settings.getByText('Binder address saved.')).toBeVisible();
    await expect(settings.getByRole('switch', { name: 'Show prices on shared binder' })).not.toBeChecked();
    await expect(page.locator('[data-toaster]')).not.toContainText('share link', { timeout: 10_000 });
    // The link is built from the page's origin; show the address people get in production, not the local port.
    await settings.evaluate((element, origin) => {
      const swap = (value: string) => value.replace(origin, 'https://holofolder.com');
      for (const input of element.querySelectorAll('input')) input.value = swap(input.value);
      const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (texts.nextNode()) texts.currentNode.textContent = swap(texts.currentNode.textContent ?? '');
    }, new URL(page.url()).origin);
    await expect(settings).not.toContainText('localhost');
    await shoot(page, 'sharing-settings');
  });

  test('partners', async ({ page, baseURL }) => {
    await start(page, baseURL);
    await openMore(page, 'Partner');
    const partner = page.getByRole('dialog', { name: 'Partner Mode', exact: true });
    await expect(partner).toBeVisible();
    await partner.getByRole('textbox').first().fill('partner@holofolder.test');
    await partner.getByRole('textbox').first().blur();
    await shoot(page, 'partners-invite');
  });

  test('history', async ({ page, baseURL }) => {
    await prepare(page, baseURL);
    const scope = { accountId: E2E_USER.id, ownerId: E2E_USER.id, membershipKey: 'synthetic-membership' };
    // Synthetic history: one card change per entry, over today and yesterday.
    const card = (cardId: string, cardName: string, finish: string, status = 'collected') => ({
      card_id: cardId,
      card_name: cardName,
      card_set: cardId.startsWith('base1') ? 'Base Set' : '151',
      card_finish: finish,
      card_language: 'en',
      status,
    });
    const entries: Array<[number, ReturnType<typeof card> | null, ReturnType<typeof card> | null]> = [
      [25, null, card('sv03.5-006', 'Charizard ex', 'holo')],
      [70, null, card('sv03.5-004', 'Charmander', 'reverse_holo')],
      [190, null, card('sv03.5-007', 'Squirtle', 'normal', 'wishlisted')],
      [1500, null, card('base1-46', 'Charmander', 'normal')],
      [1560, null, card('base1-44', 'Bulbasaur', 'normal')],
      [1620, card('sv03.5-005', 'Charmeleon', 'normal'), null],
    ];
    const data = entries.map(([minutesAgo, before, after], i) => ({
      id: String(9000 - i),
      recorded_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
      format_version: 1,
      actor_kind: 'user',
      actor_user_id: E2E_USER.id,
      source: 'app',
      // An app write the native Undo understands (lib/collection/native-recovery-intent.ts).
      action: 'inventory.add',
      affected_entities: { collectionIds: ['22222222-2222-4222-8222-222222222222'], inventoryItemIds: [`copy-${i}`] },
      changes: [{ table: 'inventory_items', id: `copy-${i}`, before, after }],
    }));
    await page.route('**/app/api/collection-activity**', (route) =>
      new URL(route.request().url()).searchParams.get('scope') === '1'
        ? route.fulfill({ json: { scope } })
        : route.fulfill({ json: { scope, data, nextCursor: null, syncedAt: new Date().toISOString() } }),
    );
    const harness = await open(page);
    await toBinder(harness);
    await (await openStorage(page)).getByRole('button', { name: 'Activity', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: /Activity/ });
    await expect(dialog.getByRole('article').first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'See what undoing does' }).first()).toBeVisible();
    // The harness has no legacy binders list, so the filter line names the binder "Previous collection"; hide it.
    await dialog.getByText('Previous collection', { exact: true }).evaluate((element) => {
      (element as HTMLElement).style.visibility = 'hidden';
    });
    await shoot(page, 'history-activity');
  });

  test('offline sync notice', async ({ page, baseURL, context }) => {
    const harness = await start(page, baseURL);
    await toBinder(harness);
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toBeEnabled({ timeout: 15_000 });
    await context.setOffline(true);
    await appendPocket(page);
    await expect(page.locator('[data-sync-state="offline"]')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await shoot(page, 'troubleshooting-sync-notice');
  });
});
