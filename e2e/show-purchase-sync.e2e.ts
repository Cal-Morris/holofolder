import type { Page } from '@playwright/test';
import { test, expect, E2E_USER, SUPABASE_URL, seedCollection, type Harness } from './fixtures';
import { HUNT_COLLECTION, HUNT_PRICES } from './hunt-fixtures';
import { mockCardPrices } from './price-fixtures';

const SCREENS = process.env.E2E_SCREENSHOT_DIR;

async function screenshot(harness: Harness, name: string) {
  if (SCREENS && test.info().project.name.startsWith('standalone-390'))
    await harness.page.screenshot({ path: `${SCREENS}/quick-${name}.png` });
}

const banner = (harness: Harness) => harness.page.getByRole('region', { name: 'Show mode' });
const quickDialog = (harness: Harness) => harness.page.getByRole('dialog', { name: 'Quick mode' });

type Row = Record<string, unknown> & { client_id: string };

/** public.show_purchases with its real unique key: inserts ignore a client_id that is already there. */
async function mockShowPurchases(page: Page, initial: Row[] = []) {
  const account = {
    rows: new Map(initial.map((row) => [row.client_id, row])),
    posts: [] as Array<{ url: string; prefer: string; body: Row[] }>,
    deletes: [] as string[],
  };
  await page.route(`${SUPABASE_URL}/rest/v1/show_purchases**`, async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'POST') {
      const body = request.postDataJSON() as Row[] | Row;
      const rows = Array.isArray(body) ? body : [body];
      account.posts.push({ url: request.url(), prefer: request.headers()['prefer'] ?? '', body: rows });
      for (const row of rows) if (!account.rows.has(row.client_id)) account.rows.set(row.client_id, row);
      return route.fulfill({ status: 201, body: '' });
    }
    if (method === 'DELETE') {
      const ids = (new URL(request.url()).searchParams.get('client_id') ?? '')
        .replace(/^in\.\(|\)$/g, '')
        .split(',')
        .map((id) => id.replace(/"/g, ''));
      for (const id of ids) {
        account.deletes.push(id);
        account.rows.delete(id);
      }
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ json: [...account.rows.values()] });
  });
  return account;
}

/** Collection edits (inventory and slot commands) the device sends to the synthetic storage backend. */
function storageSends(page: Page) {
  const sends: string[] = [];
  page.on('request', (request) => {
    const kind = /\/storage\/(inventory|slots)$/.exec(new URL(request.url()).pathname)?.[1];
    if (request.method() === 'POST' && kind) sends.push(kind);
  });
  return sends;
}

async function openShowMode(harness: Harness) {
  if (!(await banner(harness).isVisible()))
    await harness.page.getByRole('button', { name: 'Show mode', exact: true }).click();
  await harness.page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(quickDialog(harness)).toBeVisible();
  return quickDialog(harness);
}

test.describe('show purchases on the account', () => {
  test.use({ signedIn: true });

  test("a fresh install or a partner's phone shows the show's purchases", async ({ harness }) => {
    const { page } = harness;
    const boughtAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await mockShowPurchases(page, [
      {
        owner_user_id: E2E_USER.id,
        client_id: 'partner-1',
        card_id: 'sv03.5-007',
        card_name: 'Squirtle',
        language: 'en',
        finish: 'normal',
        price: 12,
        market_price: 15,
        currency: 'GBP',
        bought_at: boughtAt,
        bundle_id: null,
      },
      // A purchase from an earlier show stays out of today's tally.
      {
        owner_user_id: E2E_USER.id,
        client_id: 'old-show',
        card_id: 'sv03.5-004',
        card_name: 'Charmander',
        language: 'en',
        finish: 'normal',
        price: 99,
        market_price: null,
        currency: 'GBP',
        bought_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
        bundle_id: null,
      },
    ]);
    await page.reload();
    await page.getByRole('button', { name: 'Show mode', exact: true }).click();
    await expect(banner(harness)).toContainText('1 bought · £12.00');
    await harness.expectNoHorizontalOverflow();
    await screenshot(harness, 'show-purchase-synced');
  });

  test('Bought puts the card in the pocket that wanted it, and Undo takes the card and the purchase back', async ({
    harness,
  }) => {
    const { page } = harness;
    const account = await mockShowPurchases(page);
    const sends = storageSends(page);
    await seedCollection(page, HUNT_COLLECTION);
    await mockCardPrices(page, HUNT_PRICES);
    await harness.reload();
    const dialog = await openShowMode(harness);
    // Charizard's pocket (Page 1 · Pocket 6 of the 4×4 binder) wants the 151 holo.
    await dialog
      .getByTestId('show-hunt')
      .getByRole('region', { name: 'Hunting Charizard' })
      .getByRole('button', { name: /^Charizard ex, 151/ })
      .click();
    const check = dialog.getByTestId('quick-card-check');
    await expect(check.getByTestId('quick-card-status')).toHaveText('Wanted ×1');
    const bought = check.getByRole('button', { name: 'Bought', exact: true });
    // Nothing to buy until there's an asking price.
    await expect(bought).toBeDisabled();
    const input = check.getByRole('textbox', { name: 'Asking price' });
    await input.fill('45');
    await input.press('Enter');
    await harness.expectMinTapTarget(bought, 48);
    await bought.click();
    await expect(check.getByRole('status').filter({ hasText: 'Bought Charizard ex for £45.00' })).toContainText(
      'Added to Page 1 · Pocket 6',
    );
    await expect(check.getByTestId('quick-card-status')).toHaveText('Owned ×1');
    await expect(banner(harness)).toContainText('1 bought · £45.00');
    await expect.poll(() => sends.length).toBe(1);
    await expect.poll(() => account.posts.flatMap((post) => post.body)).toHaveLength(1);
    expect(account.posts[0].body[0]).toMatchObject({
      owner_user_id: E2E_USER.id,
      card_id: 'sv03.5-006',
      finish: 'holo',
      price: 45,
      market_price: 50,
      currency: 'GBP',
    });
    await screenshot(harness, 'show-bought');

    // Undo removes the new copy, puts the want back in its pocket and takes the purchase off the tally.
    await check.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(check.getByTestId('quick-card-status')).toHaveText('Wanted ×1');
    await expect(banner(harness)).not.toContainText('bought');
    await expect.poll(() => account.deletes).toEqual([account.posts[0].body[0].client_id]);
    // A linked pair: remove the copy, then restore the pocket's want.
    await expect.poll(() => sends).toEqual(['inventory', 'inventory', 'slots']);
    await harness.expectNoHorizontalOverflow();
  });

  test('Bought with no wanted pocket adds the card to the inventory, and works offline', async ({ harness }) => {
    const { page } = harness;
    const account = await mockShowPurchases(page);
    const sends = storageSends(page);
    const bodies: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/storage/inventory'))
        bodies.push(request.postData() ?? '');
    });
    await mockCardPrices(page, { 'sv03.5-007': { finish: 'normal', market: 1, confidence: 'high' } });
    const dialog = await openShowMode(harness);
    await dialog.getByRole('searchbox').fill('squirtle');
    await dialog
      .getByRole('region', { name: 'Cards' })
      .getByRole('button', { name: /^Squirtle, 151 / })
      .first()
      .click();
    const check = dialog.getByTestId('quick-card-check');
    await expect(check.getByTestId('quick-card-status')).toHaveText('No exact saved match');
    // At a show with no signal: saved on the device, sent once back online.
    await page.context().setOffline(true);
    const input = check.getByRole('textbox', { name: 'Asking price' });
    await input.fill('2');
    await input.press('Enter');
    await check.getByRole('button', { name: 'Bought', exact: true }).click();
    await expect(check.getByRole('status').filter({ hasText: 'Bought Squirtle for £2.00' })).toContainText(
      'Added to your inventory',
    );
    // The copy is unassigned, so it isn't counted in this binder's Owned / Wanted label.
    await expect(check.getByTestId('quick-card-status')).toHaveText('No exact saved match');
    await expect(banner(harness)).toContainText('1 bought · £2.00');
    expect(sends).toHaveLength(0);
    expect(account.posts).toHaveLength(0);
    await page.context().setOffline(false);
    await expect.poll(() => sends.length).toBe(1);
    // One new copy, with no pocket.
    expect(bodies.join()).toContain('"kind":"add"');
    expect(bodies.join()).toContain(
      '"identity":{"kind":"card","cardId":"sv03.5-007","language":"en","finish":"normal"}',
    );
    expect(bodies.join()).not.toContain('"kind":"assign"');
    await expect
      .poll(() => account.posts.flatMap((post) => post.body).map((row) => row.card_id))
      .toEqual(['sv03.5-007']);
    await expect(banner(harness)).toContainText('1 bought · £2.00');
  });

  test('Bought bundle adds every card and splits the total across them by market price', async ({ harness }) => {
    const { page } = harness;
    const account = await mockShowPurchases(page);
    const sends = storageSends(page);
    await mockCardPrices(page, {
      'sv03.5-006': { finish: 'holo', market: 30, confidence: 'high' },
      'sv03.5-007': { finish: 'normal', market: 10, confidence: 'high' },
    });
    const dialog = await openShowMode(harness);
    for (const [query, name] of [
      ['charizard', /^Charizard ex, 151 /],
      ['squirtle', /^Squirtle, 151 /],
    ] as const) {
      await dialog.getByRole('searchbox').fill(query);
      await dialog.getByRole('region', { name: 'Cards' }).getByRole('button', { name }).first().click();
      const check = dialog.getByTestId('quick-card-check');
      await check.getByRole('button', { name: 'Add to bundle' }).click();
      await check.getByRole('button', { name: 'Back to results' }).click();
    }
    await dialog.getByRole('button', { name: /^Bundle · 2 cards/ }).click();
    const bundle = dialog.getByTestId('quick-bundle');
    const input = bundle.getByRole('textbox', { name: 'Bundle price' });
    await input.fill('20');
    await input.press('Enter');
    await bundle.getByRole('button', { name: 'Bought bundle', exact: true }).click();
    // Neither printing is wanted here, so both copies go to the inventory, as one edit.
    await expect(bundle.getByRole('status').filter({ hasText: 'Bought 2 cards for £20.00' })).toContainText(
      'Added to your inventory',
    );
    await expect.poll(() => sends.length).toBe(1);
    await expect(banner(harness)).toContainText('2 bought · £20.00');
    await screenshot(harness, 'show-bought-bundle');
    await expect
      .poll(() =>
        account.posts
          .flatMap((post) => post.body)
          .map((row) => [row.card_id, row.price])
          .sort(),
      )
      .toEqual([
        ['sv03.5-006', 15],
        ['sv03.5-007', 5],
      ]);
    const rows = account.posts.flatMap((post) => post.body);
    expect(rows[0].bundle_id).toBeTruthy();
    expect(rows[0].bundle_id).toBe(rows[1].bundle_id);
  });

  test('Show mode Pokémon results say Not in binder', async ({ harness }) => {
    const dialog = await openShowMode(harness);
    await dialog.getByRole('searchbox').fill('charmeleon');
    await expect(
      dialog.getByRole('region', { name: 'Pokémon' }).getByRole('button', { name: /charmeleon/i }),
    ).toContainText('Not in binder');
  });
});
