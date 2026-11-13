import type { Page, Route, TestInfo } from '@playwright/test';
import { expect, MOCK_CARDS, test, type Harness } from './fixtures';

const MY_BINDER = 'e2e00000-0000-4000-8000-000000000001';
const TRADES = 'e2e00000-0000-4000-8000-000000000002';
const CREATED = 'e2e00000-0000-4000-8000-000000000003';

type FakeBinder = { id: string; name: string; sortOrder: number; isDefault: boolean; slotCount: number };

/** Optional screenshots for reviews: set BINDERS_SCREENS_DIR to a folder. */
async function snap(page: Page, testInfo: TestInfo, name: string) {
  const dir = process.env.BINDERS_SCREENS_DIR;
  if (!dir || !testInfo.project.name.startsWith('browser-375')) return;
  await page.screenshot({ path: `${dir}/binders-${name}.png` });
}

/** In-memory /app/api/binders plus per-binder collection reads. */
class FakeBinders {
  binders: FakeBinder[] = [
    { id: MY_BINDER, name: 'My binder', sortOrder: 0, isDefault: true, slotCount: 2 },
    { id: TRADES, name: 'Trades', sortOrder: 1, isDefault: false, slotCount: 1 },
  ];
  requests: Array<{ method: string; body: unknown; query: string }> = [];

  list(ownerUserId: string) {
    return [...this.binders]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((binder) => ({
        ...binder,
        ownerUserId,
        color: null,
        rows: null,
        cols: null,
        createdAt: null,
        updatedAt: null,
      }));
  }

  async install(page: Page, ownerUserId = '00000000-0000-4000-8000-0000000000e2') {
    await page.route('**/app/api/binders**', (route) => this.handle(route, ownerUserId));
  }

  private handle(route: Route, ownerUserId: string) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = method === 'POST' || method === 'PATCH' ? request.postDataJSON() : null;
    this.requests.push({ method, body, query: url.search });
    if (method === 'POST') {
      this.binders.push({
        id: CREATED,
        name: body.name,
        sortOrder: this.binders.length,
        isDefault: false,
        slotCount: 0,
      });
      return route.fulfill({ json: { binders: this.list(ownerUserId), createdBinderId: CREATED } });
    }
    if (method === 'PATCH' && Array.isArray(body.order)) {
      body.order.forEach((id: string, index: number) => {
        const binder = this.binders.find((item) => item.id === id);
        if (binder) binder.sortOrder = index;
      });
    } else if (method === 'PATCH') {
      const binder = this.binders.find((item) => item.id === body.id);
      if (binder) binder.name = body.name;
    } else if (method === 'DELETE') {
      const id = url.searchParams.get('id');
      const target = this.binders.find((item) => item.id === id);
      if (this.binders.length <= 1)
        return route.fulfill({ status: 409, json: { error: 'last', reason: 'last-binder' } });
      if (target && target.slotCount > 0 && url.searchParams.get('confirm') !== '1') {
        return route.fulfill({
          status: 409,
          json: { error: 'confirm', reason: 'needs-confirmation', slotCount: target.slotCount },
        });
      }
      this.binders = this.binders.filter((item) => item.id !== id);
    }
    return route.fulfill({ json: { binders: this.list(ownerUserId) } });
  }
}

async function openWithBinders(harness: Harness, query = '') {
  await harness.page.goto(`/app/e2e-harness?signedIn=1&binders=1${query}`);
  await expect(harness.dock()).toBeVisible({ timeout: 30_000 });
}

async function openSwitcher(harness: Harness) {
  const trigger = harness.page.getByTestId('binder-switcher-trigger');
  await expect(trigger).toBeVisible();
  await harness.expectMinTapTarget(trigger);
  await trigger.click();
  const sheet = harness.page.getByRole('dialog', { name: 'Binders' });
  await expect(sheet).toBeVisible();
  return sheet;
}

const slot = (page: Page, dexId: number) => page.locator(`button[data-dex-id="${dexId}"]`).first();

test.describe('multiple binders', () => {
  test.use({ signedIn: true });

  test('the switcher fits the phone, closes every way and switches binders', async ({ harness }, testInfo) => {
    const { page } = harness;
    const fake = new FakeBinders();
    await fake.install(page);
    await openWithBinders(harness);
    await expect(page.getByTestId('binder-switcher-trigger')).toHaveAttribute('aria-label', 'Binders: My binder');

    let sheet = await openSwitcher(harness);
    await expect(sheet.getByText('1025 slots')).toHaveCount(2);
    await expect(sheet.getByText('2 slots', { exact: true })).toHaveCount(0);
    const trades = sheet.getByRole('button', { name: /^Trades/ });
    await harness.expectWithinSafeViewport(harness.closeControl(sheet));
    await harness.expectMinTapTarget(harness.closeControl(sheet));
    await harness.expectWithinSafeViewport(trades);
    await harness.expectHittable(trades);
    await harness.expectNoHorizontalOverflow();
    await snap(page, testInfo, 'switcher');

    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await harness.expectScrollUnlocked();
    sheet = await openSwitcher(harness);
    await harness.tapBackdrop(sheet);
    await expect(sheet).toHaveCount(0);
    sheet = await openSwitcher(harness);
    await harness.swipeDown(sheet);
    await expect(sheet).toHaveCount(0);

    sheet = await openSwitcher(harness);
    await sheet.getByRole('button', { name: /^Trades/ }).click();
    await expect(page).toHaveURL(new RegExp(`binder=${TRADES}`));
    await expect(page.getByTestId('binder-switcher-trigger')).toHaveAttribute('aria-label', 'Binders: Trades');
    await expect(slot(page, 4)).toBeVisible();
    // Bulbasaur is only in "My binder".
    await expect
      .poll(async () => (await slot(page, 1).getAttribute('aria-label')) ?? '')
      .not.toMatch(/collected|owned/i);
    const cookies = await page.context().cookies();
    expect(cookies.find((cookie) => cookie.name === 'binderdex_binder')?.value).toBe(TRADES);
    expect(await page.evaluate(() => window.localStorage.getItem('binderdex:last-binder'))).toBe(TRADES);
  });

  test('create, rename and reorder; deleting asks first, cards need a second confirmation, the last binder stays', async ({
    harness,
  }, testInfo) => {
    const { page } = harness;
    const fake = new FakeBinders();
    await fake.install(page);
    await openWithBinders(harness);

    const sheet = await openSwitcher(harness);
    await sheet.getByRole('button', { name: 'Edit' }).click();
    await sheet.getByRole('button', { name: 'Rename Trades' }).click();
    await sheet.getByRole('textbox', { name: 'New name for Trades' }).fill('Trade binder');
    await sheet.getByRole('button', { name: 'Save name' }).click();
    await expect(sheet.getByText('Trade binder')).toBeVisible();
    expect(fake.requests.at(-1)).toMatchObject({ method: 'PATCH', body: { id: TRADES, name: 'Trade binder' } });

    await sheet.getByRole('button', { name: 'Move Trade binder up' }).click();
    await expect.poll(() => fake.requests.at(-1)?.body).toEqual({ order: [TRADES, MY_BINDER] });
    await expect(sheet.getByRole('listitem').first()).toContainText('Trade binder');

    // Delete: a binder with cards needs the extra checkbox.
    await sheet.getByRole('button', { name: 'Delete Trade binder' }).click();
    const confirm = sheet.getByRole('group', { name: 'Confirm deleting Trade binder' });
    await expect(confirm).toContainText('1 slot');
    const deleteButton = confirm.getByRole('button', { name: 'Delete binder' });
    await expect(deleteButton).toBeDisabled();
    await harness.expectWithinSafeViewport(deleteButton);
    await snap(page, testInfo, 'delete-confirm');
    await confirm.getByRole('button', { name: 'Keep' }).click();
    await expect(confirm).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Delete Trade binder' }).click();
    await confirm.getByRole('checkbox').check();
    await deleteButton.click();
    await expect(sheet.getByText('Trade binder')).toHaveCount(0);
    expect(fake.requests.at(-1)).toMatchObject({ method: 'DELETE', query: `?id=${TRADES}&confirm=1` });
    // The last binder can't be deleted.
    await expect(sheet.getByRole('button', { name: 'Delete My binder' })).toBeDisabled();

    await sheet.getByRole('button', { name: 'Done' }).click();
    await sheet.getByRole('textbox', { name: 'New binder name' }).fill('Holos');
    await sheet.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(new RegExp(`binder=${CREATED}`));
    expect(fake.requests.find((request) => request.method === 'POST')?.body).toEqual({ name: 'Holos' });
  });

  test("a partner sees the owner's binders", async ({ harness }) => {
    const { page } = harness;
    const fake = new FakeBinders();
    await fake.install(page, '00000000-0000-4000-8000-0000000000e3');
    await openWithBinders(harness, `&partner=1&binder=${TRADES}`);
    await expect(page.getByTestId('binder-switcher-trigger')).toHaveAttribute('aria-label', 'Binders: Trades');

    const sheet = await openSwitcher(harness);
    await expect(sheet.getByText('A partner shares them all.', { exact: false })).toBeVisible();
    await expect(sheet.getByRole('listitem')).toHaveCount(2);
  });
});

test.describe('card languages in the all cards sheet', () => {
  test.use({ signedIn: true });

  test('English only by default: other languages are hidden and language words filter the search', async ({
    harness,
  }) => {
    const { page } = harness;
    // Synthetic printings: two English-set cards (also printed in French) and one Japanese-only card.
    const english = MOCK_CARDS.filter((card) => card.dexIds.includes(1)).slice(0, 2);
    const cards = [
      ...english.map(({ dexIds: _dexIds, ...card }) => ({ ...card, languages: ['en', 'fr'] })),
      { ...english[0], dexIds: undefined, id: 'jp-test-001', name: 'Fushigidane', languages: ['ja'] },
    ];
    await page.route('**/app/api/tcgdex-cache**', (route) => route.fulfill({ json: { cards } }));
    const detail = await harness.openCardDetail();
    await detail
      .getByRole('button', { name: /all bulbasaur cards/i })
      .first()
      .click();
    const sheet = page.getByRole('dialog', { name: 'All Bulbasaur cards', exact: true });
    await expect(sheet).toBeVisible();
    const grid = sheet.getByRole('list', { name: 'Bulbasaur cards' }).getByRole('listitem');

    await expect(grid).toHaveCount(2);
    await expect(sheet.getByText('Fushigidane')).toHaveCount(0);
    await expect(sheet.getByText(/1 printing in other languages hidden/)).toBeVisible();
    // One language shown, so no language filter.
    await expect(sheet.getByRole('group', { name: 'Filter by language' })).toHaveCount(0);
    await sheet.getByRole('searchbox').fill('eng');
    await expect(grid).toHaveCount(2);
    await sheet.getByRole('searchbox').fill('jpn');
    await expect(grid).toHaveCount(0);
    await harness.expectNoHorizontalOverflow();
  });
});
