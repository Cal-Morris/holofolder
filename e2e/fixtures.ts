/* eslint-disable react-hooks/rules-of-hooks -- Playwright fixtures call `use`, not a React hook. */
import { test as base, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';

export const SAFE_AREA = { top: 59, bottom: 34, left: 0, right: 0 };

export const E2E_USER = {
  id: '00000000-0000-4000-8000-0000000000e2',
  aud: 'authenticated',
  role: 'authenticated',
  email: 'e2e@holofolder.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: {},
  created_at: '2026-01-01T00:00:00.000Z',
};

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54399';

export const SEEDED_COLLECTION = [
  {
    id: 'e2e-1',
    user_id: E2E_USER.id,
    pokemon_id: 1,
    pokemon_name: 'bulbasaur',
    card_id: 'base1-44',
    card_name: 'Bulbasaur',
    card_set: 'Base Set',
    card_language: 'en',
    card_finish: 'normal',
    wanted_cards: [],
    status: 'collected',
    collected_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'e2e-4',
    user_id: E2E_USER.id,
    pokemon_id: 4,
    pokemon_name: 'charmander',
    card_id: 'base1-46',
    card_name: 'Charmander',
    card_set: 'Base Set',
    card_language: 'en',
    card_finish: 'normal',
    wanted_cards: [],
    status: 'collected',
    collected_at: '2026-01-01T00:00:00.000Z',
  },
];

function base64Url(value: string) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A locally valid (unsigned) Supabase session so the browser client treats the user as signed in. */
function fakeSessionCookieValue() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = [
    base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' })),
    base64Url(
      JSON.stringify({
        sub: E2E_USER.id,
        session_id: 'synthetic-e2e-auth-session',
        aud: 'authenticated',
        role: 'authenticated',
        exp: expiresAt,
        email: E2E_USER.email,
      }),
    ),
    'e2e',
  ].join('.');
  const session = {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: 'e2e-refresh',
    user: E2E_USER,
  };
  return `base64-${base64Url(JSON.stringify(session))}`;
}

type MockCard = {
  id: string;
  localId: string;
  name: string;
  image: string;
  set: { id: string; name: string; officialCardCount: number; releaseDate: string };
  rarity: string;
  variants: Record<string, boolean>;
  dexIds: number[];
  illustrator?: string;
};

function mockCard(
  dexId: number,
  name: string,
  setId: string,
  setName: string,
  localId: string,
  total: number,
  releaseDate: string,
  rarity: string,
  variants: Record<string, boolean>,
): MockCard {
  return {
    id: `${setId}-${localId}`,
    localId,
    name,
    image: `https://assets.tcgdex.net/en/mock/${setId}/${localId}/high.webp`,
    set: { id: setId, name: setName, officialCardCount: total, releaseDate },
    rarity,
    variants,
    dexIds: [dexId],
  };
}

/** Printings served by the mocked TCG mirror (/app/api/tcgdex-cache and /app/api/tcg-card-search). */
export const MOCK_CARDS: MockCard[] = [
  mockCard(1, 'Bulbasaur', 'base1', 'Base Set', '44', 102, '1999-01-09', 'Common', {
    normal: true,
    firstEdition: true,
  }),
  mockCard(1, 'Bulbasaur', 'sv03.5', '151', '001', 165, '2023-09-22', 'Common', { normal: true, reverse: true }),
  mockCard(1, 'Bulbasaur', 'sv03.5', '151', '166', 165, '2023-09-22', 'Illustration Rare', { holo: true }),
  mockCard(1, 'Bulbasaur', 'me02', 'Phantasmal Flames', '001', 94, '2025-11-14', 'Common', {
    normal: true,
    reverse: true,
  }),
  mockCard(1, 'Bulbasaur', 'swsh12pt5', 'Crown Zenith', '001', 159, '2023-01-20', 'Common', {
    normal: true,
    reverse: true,
  }),
  mockCard(1, 'Bulbasaur', 'me05', 'Pitch Black', '001', 84, '2026-07-17', 'Common', { normal: true, reverse: true }),
  mockCard(4, 'Charmander', 'base1', 'Base Set', '46', 102, '1999-01-09', 'Common', {
    normal: true,
    firstEdition: true,
  }),
  mockCard(4, 'Charmander', 'sv03.5', '151', '004', 165, '2023-09-22', 'Common', { normal: true, reverse: true }),
  mockCard(4, 'Charmander', 'sv03.5', '151', '168', 165, '2023-09-22', 'Illustration Rare', { holo: true }),
  mockCard(5, 'Charmeleon', 'sv03.5', '151', '005', 165, '2023-09-22', 'Uncommon', { normal: true, reverse: true }),
  mockCard(6, 'Charizard ex', 'sv03.5', '151', '006', 165, '2023-09-22', 'Double Rare', { holo: true }),
  // Synthetic Squirtle printings for the wanted-slot regression tests: a normal set, 30th Celebration and
  // 30th Classic Collection (which has no official card count in TCGdex).
  mockCard(7, 'Squirtle', 'sv03.5', '151', '007', 165, '2023-09-22', 'Common', { normal: true, reverse: true }),
  mockCard(7, 'Squirtle', '30th', '30th Celebration', '007', 128, '2026-09-16', 'Common', { holo: true }),
  mockCard(7, 'Squirtle', '30th-c', '30th Classic Collection', '003', 0, '2026-09-16', 'None', { normal: true }),
];

const CARD_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2'];

export function placeholderSvg(label: string, seed: number) {
  const color = CARD_PALETTE[seed % CARD_PALETTE.length];
  const safe = label.replace(/[^a-zA-Z0-9 #./-]/g, '').slice(0, 24);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="245" height="342" viewBox="0 0 245 342"><rect width="245" height="342" rx="14" fill="${color}"/><rect x="12" y="12" width="221" height="318" rx="10" fill="#f8fafc" opacity="0.9"/><rect x="24" y="48" width="197" height="140" rx="6" fill="${color}" opacity="0.35"/><text x="122" y="230" font-family="sans-serif" font-size="20" font-weight="700" text-anchor="middle" fill="#0f172a">${safe}</text></svg>`;
}

/**
 * Synthetic illustrator credits for the mock printings (illustrator browse tests). Not real credits for
 * these cards; any printing not listed has no illustrator.
 */
const MOCK_ILLUSTRATORS: Record<string, string> = {
  'base1-44': 'Mitsuhiro Arita',
  'base1-46': 'Mitsuhiro Arita',
  'sv03.5-166': 'Mitsuhiro Arita',
  'sv03.5-168': 'Kouki Saitō',
  'sv03.5-001': '5ban Graphics',
  'sv03.5-004': '5ban Graphics',
};
for (const card of MOCK_CARDS) {
  if (MOCK_ILLUSTRATORS[card.id]) card.illustrator = MOCK_ILLUSTRATORS[card.id];
}

/** Directory and per-illustrator lists, shaped like /app/api/tcg-illustrators. */
export function mockIllustratorResponse(url: string) {
  const name = new URL(url).searchParams.get('name');
  if (name === null) {
    const counts = new Map<string, number>();
    for (const card of MOCK_CARDS)
      if (card.illustrator) counts.set(card.illustrator, (counts.get(card.illustrator) ?? 0) + 1);
    return {
      illustrators: [...counts]
        .map(([illustratorName, cardCount]) => ({ name: illustratorName, cardCount }))
        .sort((a, b) => b.cardCount - a.cardCount),
    };
  }
  return { illustrator: name, cards: MOCK_CARDS.filter((card) => card.illustrator === name) };
}

/** Search and Sort are always on Inventory's row. Raw or graded, and who graded it, open from Filters. */
export async function openInventoryFilters(page: Page) {
  const filters = page.getByRole('group', { name: 'Filters', exact: true });
  if (!(await filters.isVisible())) await page.getByRole('button', { name: /^Filters/ }).click();
  await expect(filters).toBeVisible();
}
/** Make the page look like an installed PWA (display-mode: standalone, navigator.standalone, safe areas). */
/** Native storage actions live in the Storage menu under the app header. Returns the open menu. */
export async function openStorage(page: Page) {
  const menu = page.getByRole('dialog', { name: 'Storage', exact: true });
  if (!(await menu.isVisible())) await page.getByRole('button', { name: 'Storage', exact: true }).click();
  await expect(menu).toBeVisible();
  return menu;
}
export async function storageAction(page: Page, name: string) {
  return (await openStorage(page)).getByRole('button', { name, exact: true });
}
/** Layout editing: opens Edit layout unless already editing, then Add → At the end of the binder (one empty pocket). */
export async function appendPocket(page: Page) {
  const edit = page.getByRole('button', { name: 'Edit layout', exact: true });
  const add = page.locator('[data-layout-bar]').getByRole('button', { name: 'Add', exact: true });
  await expect(edit.or(add)).toBeVisible();
  if (await edit.isVisible()) await edit.click();
  await add.click();
  await page.getByRole('menuitem', { name: 'At the end of the binder', exact: true }).click();
}
export async function closeStorage(page: Page) {
  const close = page.getByRole('button', { name: 'Close storage', exact: true });
  if (await close.isVisible()) await close.click();
}

/** Native collection and view selectors are enclosed menu buttons. `data-value` carries the exact id or view. */
/** A row of the Settings list (its name may carry a summary after a comma, e.g. "Layout, 3×3"). */
export const settingsRow = (dialog: Locator, title: string) =>
  dialog.getByRole('button', { name: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) });

/** Opens a page of the open Settings dialog, going back to the list first if another page is showing. */
export async function openSettingsPage(dialog: Locator, title: string) {
  const back = dialog.getByRole('button', { name: 'Back to Settings', exact: true });
  if (await back.isVisible()) await back.click();
  await settingsRow(dialog, title).click();
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeVisible();
  return dialog;
}

export const collectionPicker = (page: Page) => page.getByRole('button', { name: 'Collection', exact: true });
export const viewPicker = (page: Page) => page.getByRole('button', { name: 'Collection view', exact: true });
async function choose(page: Page, trigger: Locator, menu: string, value: string) {
  await trigger.click();
  await page
    .getByRole('dialog', { name: menu, exact: true })
    .locator(`[role="menuitemradio"][data-value="${value}"]`)
    .click();
}
export const chooseCollection = (page: Page, id: string) =>
  choose(page, collectionPicker(page), 'Choose collection', id);
export const chooseView = (page: Page, view: string) => choose(page, viewPicker(page), 'Choose view', view);
/** The binder's pocket filter ("Show pockets"): all, owned, wanted or needed (shown as Missing). */
export const pocketFilter = (page: Page) => page.getByRole('button', { name: 'Show pockets', exact: true });
export const choosePockets = (page: Page, filter: 'all' | 'owned' | 'wanted' | 'needed') =>
  choose(page, pocketFilter(page), 'Choose pockets', filter);

export async function emulateStandalone(page: Page, insets: typeof SAFE_AREA) {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) => {
      if (query.includes('display-mode: standalone')) {
        return { ...originalMatchMedia('(min-width: 0px)'), media: query, matches: true } as MediaQueryList;
      }
      return originalMatchMedia(query);
    };
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
  });
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setSafeAreaInsetsOverride' as never, { insets } as never).catch(() => undefined);
  await session
    .send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] })
    .catch(() => undefined);
}

/**
 * Mock every backend the binder talks to. `target` is the page, or the browser context when a service
 * worker is active (only context routes see the worker's own requests).
 */
export async function mockBackends(
  target: Page | BrowserContext,
  context: BrowserContext,
  { signedIn, baseURL }: { signedIn: boolean; baseURL?: string },
) {
  await target.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  // Synthetic lifetime access keeps existing fixtures on the previously unrestricted tier.
  await target.route('**/app/api/billing', (route) =>
    route.fulfill({
      json: {
        access: {
          ownerUserId: E2E_USER.id,
          tier: 'paid',
          source: 'perpetual',
          paidThrough: null,
          savedCardCount: 2,
          cardLimit: null,
          enforced: true,
        },
        canManage: true,
      },
    }),
  );
  await target.route('**/app/api/account-identity', (route) =>
    route.fulfill({ json: { username: null, available: false } }),
  );
  await target.route('**/app/api/binder-identity**', (route) =>
    route.fulfill({ json: { username: null, slug: null, canEdit: false, available: false } }),
  );
  await target.route('**/app/api/binder-appearance', (route) =>
    route.fulfill({ json: { ownerId: E2E_USER.id, design: null, revision: 0 } }),
  );
  await target.route('**/app/api/card-prices**', async (route) => {
    const body = route.request().postDataJSON?.() ?? {};
    const lookups: Array<{ cardId: string; language?: string }> = Array.isArray(body?.cards) ? body.cards : [];
    const now = Date.now();
    await route.fulfill({
      json: {
        prices: lookups.map((lookup) => ({
          cardId: lookup.cardId,
          language: lookup.language ?? 'en',
          gbpAmount: 0.2,
          marketGbpAmount: 0.2,
          goodGbpAmount: 0.02,
          lowGbpAmount: 0.02,
          highGbpAmount: 0.23,
          confidence: 'low',
          sourcePrices: [
            {
              source: 'tcgplayer',
              label: 'TCGplayer',
              variantLabel: 'Normal',
              marketGbpAmount: 0.2,
              lowGbpAmount: 0.02,
              originalMarketAmount: 0.26,
              originalLowAmount: 0.03,
              originalCurrency: 'USD',
              updatedAt: new Date(now - 86_400_000).toISOString(),
            },
            {
              source: 'cardmarket',
              label: 'Cardmarket',
              variantLabel: 'Trend',
              marketGbpAmount: 0.05,
              lowGbpAmount: 0.02,
              originalMarketAmount: 0.06,
              originalLowAmount: 0.02,
              originalCurrency: 'EUR',
              updatedAt: new Date(now - 86_400_000).toISOString(),
            },
          ],
          trendPoints: [
            { label: '30d', source: 'cardmarket', gbpAmount: 0.3, originalAmount: 0.35, originalCurrency: 'EUR' },
            { label: '7d', source: 'cardmarket', gbpAmount: 0.12, originalAmount: 0.14, originalCurrency: 'EUR' },
            { label: '1d', source: 'cardmarket', gbpAmount: 0.06, originalAmount: 0.07, originalCurrency: 'EUR' },
            { label: 'Trend', source: 'cardmarket', gbpAmount: 0.05, originalAmount: 0.06, originalCurrency: 'EUR' },
          ],
          buySignal: { status: 'good', label: 'Good time', reason: 'Current trend is 82% below 30d average.' },
          originalAmount: 0.26,
          originalCurrency: 'USD',
          source: 'tcgplayer',
          variantLabel: 'Normal',
          updatedAt: new Date(now - 86_400_000).toISOString(),
          fxDate: null,
          fetchedAt: now,
        })),
      },
    });
  });
  await target.route('**/app/api/tcgdex-cache**', (route) => {
    const pokemonId = Number(new URL(route.request().url()).searchParams.get('pokemonId'));
    const cards = MOCK_CARDS.filter((card) => card.dexIds.includes(pokemonId)).map(
      ({ dexIds: _dexIds, ...card }) => card,
    );
    return route.fulfill({ json: { cards, source: 'mirror' } });
  });
  await target.route('**/app/api/tcg-card-search**', (route) => {
    const query = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase().trim();
    const [first, second] = query.split(/\s+/);
    const cards = MOCK_CARDS.filter((card) => {
      const haystack =
        `${card.name} ${card.set.name} ${card.set.id} ${card.id} ${card.illustrator ?? ''}`.toLowerCase();
      if (!haystack.includes(first)) return false;
      return !second || card.localId.replace(/^0+/, '') === second.replace(/^#/, '').split('/')[0].replace(/^0+/, '');
    });
    // Like the real route (lib/tcg-mirror.ts searchMirroredCards), each result carries the searched language.
    return route.fulfill({ json: { cards: cards.map((card) => ({ ...card, language: 'en' })) } });
  });
  // Placeholder art for card images and Pokémon artwork (external hosts are otherwise blocked).
  await target.route(
    /^https:\/\/(assets\.tcgdex\.net|assets\.holofolder\.com|raw\.githubusercontent\.com)\//,
    (route) => {
      const url = route.request().url();
      const card = MOCK_CARDS.find((candidate) => url.includes(`/${candidate.set.id}/${candidate.localId}/`));
      const label = card
        ? `${card.name} ${card.localId}`
        : url.match(/(\d+)\.png$/)?.[1]
          ? `#${url.match(/(\d+)\.png$/)![1]}`
          : 'card';
      return route.fulfill({
        headers: { 'Access-Control-Allow-Origin': '*' },
        contentType: 'image/svg+xml',
        body: placeholderSvg(label, card ? MOCK_CARDS.indexOf(card) : label.length),
      });
    },
  );
  await target.route('**/app/api/card-image-proxy**', (route) => {
    const source = new URL(route.request().url()).searchParams.get('url') ?? '';
    const label = source.match(/(\d+)\.png$/)?.[1] ? `#${source.match(/(\d+)\.png$/)![1]}` : 'card';
    return route.fulfill({ contentType: 'image/svg+xml', body: placeholderSvg(label, label.length) });
  });
  await target.route('**/app/api/tcg-illustrators**', (route) =>
    route.fulfill({ json: mockIllustratorResponse(route.request().url()) }),
  );
  await target.route('**/app/api/tcg-set-slots**', (route) =>
    route.fulfill({ json: { sets: [], selectedSet: null, slots: [] } }),
  );

  if (signedIn) {
    const storageKey = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
    await context.addCookies([
      { name: storageKey, value: fakeSessionCookieValue(), url: baseURL ?? 'http://localhost:3210' },
    ]);
  }
  const showPurchases = new Map<string, unknown>();
  // Mock the Supabase API: auth returns the e2e user, every other table read is empty and writes succeed.
  await target.route(`${SUPABASE_URL}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/rpc/billing_partner_allowed')) return route.fulfill({ json: true });
    if (url.pathname.startsWith('/auth/v1/user')) {
      return signedIn
        ? route.fulfill({ json: E2E_USER })
        : route.fulfill({ status: 401, json: { message: 'no session' } });
    }
    // Supabase lists passkeys as an array; the synthetic account has none.
    if (url.pathname === '/auth/v1/passkeys' && request.method() === 'GET') return route.fulfill({ json: [] });
    if (url.pathname.startsWith('/auth/v1/')) {
      return route.fulfill({ json: {} });
    }
    // Show purchases behave like the real table (what's written reads back), so synced tallies stay put.
    if (url.pathname === '/rest/v1/show_purchases') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON() as Array<{ client_id: string }> | { client_id: string };
        for (const row of Array.isArray(body) ? body : [body])
          if (!showPurchases.has(row.client_id)) showPurchases.set(row.client_id, row);
        return route.fulfill({ status: 201, body: '' });
      }
      if (request.method() === 'DELETE') {
        for (const id of (url.searchParams.get('client_id') ?? '').replace(/^in\.\(|\)$/g, '').split(','))
          showPurchases.delete(id.replace(/"/g, ''));
        return route.fulfill({ status: 204, body: '' });
      }
      return route.fulfill({ json: [...showPurchases.values()] });
    }
    if (request.method() === 'GET' || request.method() === 'HEAD') {
      return route.fulfill({ json: [] });
    }
    return route.fulfill({ json: [] });
  });
}

/** One row per Pokémon, as specs describe a synthetic collection (the old dex-binder shape). */
export type SeedRow = {
  pokemon_id: number;
  card_id?: string | null;
  card_language?: string | null;
  card_finish?: string | null;
  status?: string | null;
  wanted_cards?: unknown[];
  collected_at?: string | null;
};

/** A synthetic catalogue card for the seeded mirror, beyond MOCK_CARDS (e.g. long synthetic want lists). */
export type SeedCard = {
  id: string;
  localId: string;
  name: string;
  set: { id: string; name: string };
  dexIds: number[];
};

/**
 * Signed-in harness storage: the real browser session, IDB queue and storage handlers over the synthetic
 * in-process ledger in tests/fixtures/storage-command-harness.ts, seeded as a 4×4 National Dex binder with
 * one pocket per Pokémon and `collection`'s owned printings as raw copies. One fresh ledger per call.
 */
export async function seedNativeStorage(
  context: BrowserContext,
  baseURL = 'http://localhost:3210',
  collection: SeedRow[] = SEEDED_COLLECTION,
  extraCards: SeedCard[] = [],
) {
  await context.addCookies([{ name: 'hf-storage-fixture', value: `harness-${crypto.randomUUID()}`, url: baseURL }]);
  const cards = [
    ...MOCK_CARDS.map(({ id, localId, name, set, dexIds }) => ({ id, localId, name, set, dexIds })),
    ...extraCards,
  ];
  const seeded = await context.request.post(`${baseURL}/app/e2e-harness/storage/seed`, {
    data: { rows: collection, cards },
  });
  expect(seeded.ok(), 'synthetic native storage seed').toBe(true);
}

/** Replace the signed-in owner's synthetic collection; reload or reopen the binder afterwards. */
export async function seedCollection(page: Page, collection: SeedRow[], extraCards: SeedCard[] = []) {
  await seedNativeStorage(page.context(), new URL(page.url()).origin, collection, extraCards);
}

type Fixtures = {
  signedIn: boolean;
  /** The signed-in owner's synthetic collection (default: Base Set Bulbasaur and Charmander owned). */
  collection: SeedRow[];
  standalone: boolean;
  insets: typeof SAFE_AREA;
  harness: Harness;
};

export class Harness {
  constructor(
    readonly page: Page,
    readonly insets: typeof SAFE_AREA,
    readonly signedIn = false,
  ) {}

  get path() {
    return this.signedIn ? '/app/e2e-harness?signedIn=1&browserHost=1' : '/app/e2e-harness';
  }

  get viewport() {
    return this.page.viewportSize()!;
  }

  /** Visible dialogs (modals, sheets, popover panels). */
  dialogs() {
    return this.page.locator('[role=dialog]:visible');
  }

  dock() {
    return this.page.getByRole('navigation', { name: 'Main navigation' });
  }

  /** The binder pocket for a National Dex number: a native storage slot when signed in, the guest dex grid otherwise. */
  slot(dex: number) {
    return this.signedIn
      ? this.page.locator(`[data-slot-id="synthetic-dex-${dex}"]`)
      : this.page.locator(`button[data-dex-id="${dex}"]`).first();
  }

  async open() {
    await this.page.goto(this.path);
    await expect(this.dock()).toBeVisible({ timeout: 30_000 });
    await expect(this.slot(1)).toBeVisible();
  }

  /** Reload and wait for the checked session: a signed-in reload paints this device's saved copy first,
   * then swaps in the live binder (which remounts any open overlay). */
  async reload() {
    await this.page.reload();
    await expect(this.slot(1)).toBeVisible({ timeout: 30_000 });
    if (this.signedIn) await expect(this.page.getByRole('button', { name: 'Edit layout', exact: true })).toBeEnabled();
  }

  async openViewOptions() {
    const dialog = this.page.getByRole('dialog', { name: 'View options', exact: true });
    if (!(await dialog.isVisible()))
      await this.page.getByTestId('app-header').getByRole('button', { name: 'View', exact: true }).click();
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async openCardDetail() {
    await this.slot(1).click();
    const dialog = this.page.getByRole('dialog', { name: /bulbasaur.* details/i });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  closeControl(dialog: Locator) {
    return dialog.getByRole('button', { name: /^close/i }).first();
  }

  /** Assert a locator is fully inside the visible area (excluding the simulated safe areas). */
  async expectWithinSafeViewport(locator: Locator) {
    const box = await locator.boundingBox();
    expect(box, 'element should be rendered').not.toBeNull();
    const { width, height } = this.viewport;
    expect(box!.y, 'top edge should be below the status bar / safe area').toBeGreaterThanOrEqual(this.insets.top - 0.5);
    expect(box!.x).toBeGreaterThanOrEqual(-0.5);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
    expect(box!.y + box!.height, 'bottom edge should be above the home indicator').toBeLessThanOrEqual(
      height - this.insets.bottom + 0.5,
    );
  }

  /**
   * The element at the centre of `locator` must be the locator itself (i.e. not covered).
   * Polled briefly: while a dock tab's view transition runs, its snapshot layer sits above the
   * whole page for a frame or two, so a single sample straight after a tap can hit `<html>`.
   */
  async expectHittable(locator: Locator) {
    await expect
      .poll(
        async () => {
          const box = await locator.boundingBox();
          if (!box) return false;
          return locator.evaluate(
            (element, point) => {
              const top = document.elementFromPoint(point.x, point.y);
              return Boolean(top && (top === element || element.contains(top)));
            },
            { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          );
        },
        { message: 'element should not be covered by another layer', timeout: 2_000 },
      )
      .toBe(true);
  }

  async expectMinTapTarget(locator: Locator, min = 36) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBeGreaterThanOrEqual(min);
    expect(Math.round(box!.height)).toBeGreaterThanOrEqual(min);
  }

  async expectNoHorizontalOverflow() {
    const overflow = await this.page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  }

  async expectScrollUnlocked() {
    await expect
      .poll(() =>
        this.page.evaluate(() => ({
          body: getComputedStyle(document.body).overflow,
          html: getComputedStyle(document.documentElement).overflow,
        })),
      )
      .toEqual(
        expect.objectContaining({
          body: expect.not.stringMatching(/hidden/),
          html: expect.not.stringMatching(/hidden/),
        }),
      );
  }

  /** Tap the backdrop at a point that is outside the dialog, header and dock. */
  async tapBackdrop(dialog: Locator) {
    await dialog.click({ trial: true });
    const box = (await dialog.boundingBox())!;
    const { width, height } = this.viewport;
    const candidates = [
      { x: 4, y: Math.round(height * 0.3) },
      { x: width - 4, y: Math.round(height * 0.3) },
      { x: Math.round(width / 2), y: Math.max(box.y - 12, this.insets.top + 4) },
    ];
    for (const point of candidates) {
      const insideDialog =
        point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;
      if (insideDialog) continue;
      const isBackdrop = await this.page.evaluate(({ x, y }) => {
        const element = document.elementFromPoint(x, y) as HTMLElement | null;
        // A native modal <dialog> paints its own ::backdrop, which hit-tests as the dialog element.
        return Boolean(element?.matches('[data-overlay-backdrop], dialog:modal'));
      }, point);
      if (isBackdrop) {
        await this.page.mouse.click(point.x, point.y);
        return;
      }
    }
    throw new Error('No backdrop area found outside the dialog');
  }

  /** Drag the sheet grabber/header downwards like a swipe-to-dismiss gesture. */
  async swipeDown(dialog: Locator) {
    const grabber = dialog.locator('[data-sheet-grabber]').first();
    await expect(grabber, 'bottom sheet should have a swipe grabber').toBeVisible();
    const box = (await grabber.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + Math.min(box.height / 2, 10);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await this.page.mouse.move(x, y + step * 25);
    }
    await this.page.mouse.up();
  }
}

export const test = base.extend<Fixtures>({
  // Wiggling pockets (layout editing) never hold still for Playwright's stability check; specs assert the class.
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      const still = () =>
        document.head.append(
          Object.assign(document.createElement('style'), { textContent: '.pocket-wiggle{animation:none!important}' }),
        );
      if (document.head) still();
      else document.addEventListener('DOMContentLoaded', still);
    });
    await use(page);
  },
  signedIn: [false, { option: true }],
  collection: [SEEDED_COLLECTION, { option: true }],
  standalone: [
    // oxlint-disable-next-line eslint/no-empty-pattern -- Playwright requires a destructured first argument.
    async ({}, use, testInfo) => {
      await use(Boolean(testInfo.project.metadata?.standalone));
    },
    { option: true },
  ],
  insets: async ({ standalone }, use) => {
    await use(standalone ? SAFE_AREA : { top: 0, bottom: 0, left: 0, right: 0 });
  },
  harness: async ({ page, standalone, insets, signedIn, collection, baseURL }, use) => {
    if (standalone) {
      await emulateStandalone(page, insets);
    }

    await mockBackends(page, page.context(), { signedIn, baseURL });
    if (signedIn) await seedNativeStorage(page.context(), baseURL, collection);

    const harness = new Harness(page, insets, signedIn);
    await harness.open();
    await use(harness);
  },
});

export { expect };
