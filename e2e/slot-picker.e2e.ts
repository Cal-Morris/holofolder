import { test, expect, Harness, mockBackends, emulateStandalone } from './fixtures';
import { syntheticSlotPickerSnapshot } from '../tests/fixtures/slot-picker';

test.describe('explicit stable-slot picker', () => {
  test.use({
    signedIn: true,
    harness: async ({ page, context, standalone, insets, baseURL }, provide) => {
      if (standalone) await emulateStandalone(page, insets);
      await mockBackends(page, context, { signedIn: true, baseURL });
      // These staged specs open their explicit synthetic slot surface, not authenticated startup.
      await provide(new Harness(page, insets, true));
    },
  });
  test.beforeEach(async ({ harness }) => {
    const { page } = harness;
    // Entirely synthetic catalog, grades and ownership, with no database executor.
    const { cards } = syntheticSlotPickerSnapshot();
    await page.route('**/app/api/tcg-card-search**', (route) => {
      const params = new URL(route.request().url()).searchParams;
      expect(params.get('includeNonPokemon')).toBe('1');
      const q = params.get('q')?.toLowerCase() ?? '';
      return route.fulfill({ json: { cards: cards.filter((c) => `${c.id} ${c.name}`.toLowerCase().includes(q)) } });
    });
    await page.route('**/app/api/card-prices', (route) => route.fulfill({ json: { prices: [] } }));
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&rows=2&cols=4');
    if (page.viewportSize()!.width >= 1024)
      await expect(page.getByRole('region', { name: 'Inside cover', exact: true })).toBeVisible();
  });
  const details = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: /details$/ });
  const sheet = (page: import('@playwright/test').Page, name: string) =>
    page.getByRole('dialog', { name, exact: true });
  const variant = (page: import('@playwright/test').Page) => sheet(page, 'Which variant?');
  const count = (page: import('@playwright/test').Page) => page.getByLabel('Synthetic draft count');
  const selector = (page: import('@playwright/test').Page) => page.getByRole('dialog', { name: 'Card selector' });
  const draft = async (page: import('@playwright/test').Page) =>
    JSON.parse((await page.getByLabel('Synthetic latest draft').textContent()) ?? 'null');
  const pocket = (page: import('@playwright/test').Page, id: string) => page.locator(`button[data-slot-id="${id}"]`);
  // Synthetic Snorlax printings served as the species list (normal and holo, so the finish is an explicit choice).
  const snorlaxList = () =>
    syntheticSlotPickerSnapshot()
      .cards.filter((c) => c.id.startsWith('synthetic-snorlax'))
      .map(({ dexIds: _dexIds, ...card }) => card);
  const routeSnorlax = (page: import('@playwright/test').Page, cards: object[] = snorlaxList()) =>
    page.route('**/app/api/tcgdex-cache**', (route) => route.fulfill({ json: { cards, source: 'mirror' } }));
  const bar = (page: import('@playwright/test').Page) =>
    page.getByRole('region', { name: 'Layout editing', exact: true });
  /** What a pocket is kept for is changed only in deliberate layout editing: select the pocket, then its options. */
  const editLayout = async (page: import('@playwright/test').Page) => {
    await bar(page).getByRole('button', { name: 'Edit layout', exact: true }).click();
    await expect(bar(page).getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  };
  const pocketOptions = async (page: import('@playwright/test').Page, id: string) => {
    await pocket(page, id).click();
    await expect(pocket(page, id)).toHaveAttribute('aria-pressed', 'true');
    await bar(page).getByRole('button', { name: 'More pocket options', exact: true }).click();
    return bar(page).getByRole('menu', { name: 'Pocket options' });
  };
  /** A free pocket opens the same visual selector, searching every card. */
  const search = async (page: import('@playwright/test').Page, slotId: string, query: string) => {
    await pocket(page, slotId).click();
    const dialog = selector(page);
    await dialog.getByRole('searchbox', { name: 'Search cards' }).fill(query);
    return dialog;
  };
  const tile = (dialog: import('@playwright/test').Locator, name: string) =>
    dialog.getByRole('button', { name: new RegExp(`^Add card ${name} from `) });

  test('card-first detail keeps slot controls secondary and supports image zoom', async ({ harness }) => {
    const { page } = harness;
    await page.locator('button[data-slot-id="slot-a"]').click();
    const dialog = details(page);
    await expect(dialog.getByRole('heading', { name: 'Snorlax A', exact: true })).toBeVisible();
    await expect(dialog).toContainText('Synthetic set · #1');
    await expect(dialog).toContainText('English');
    await expect(dialog).not.toContainText('item-a');
    await expect(dialog).not.toContainText('acceptance');
    await expect(dialog.getByRole('button', { name: 'Change target', exact: true })).not.toBeVisible();
    const preview = dialog.getByRole('button', { name: 'View Snorlax A full screen' });
    await expect(preview.getByRole('img')).toBeVisible();
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectHittable(preview);
    await harness.expectNoHorizontalOverflow();
    console.log('card detail geometry', test.info().project.name, JSON.stringify(await dialog.boundingBox()));
    await preview.click();
    const zoom = page.getByRole('dialog', { name: 'Snorlax A full screen', exact: true });
    await expect(zoom).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(zoom).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await harness.closeControl(dialog).click();
    await expect(dialog).toHaveCount(0);
    await harness.expectScrollUnlocked();
  });

  test('a free pocket pick in the visual selector saves through the variant sheet and closes, with no write transport', async ({
    harness,
  }) => {
    const { page } = harness;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== 'GET')
        writes.push(r.url());
    });
    const dialog = await search(page, 'slot-g', 'Trainer');
    // The pocket never opens a slot or draft form on the way.
    await expect(details(page)).toHaveCount(0);
    await expect(page.getByText(/Search slot catalog|Catalog language|Edit slot|Choose target/)).toHaveCount(0);
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectMinTapTarget(harness.closeControl(dialog), 36);
    await tile(dialog, 'Trainer').click();
    await expect(count(page)).toHaveText('0');
    await harness.expectWithinSafeViewport(variant(page).getByRole('button').last());
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await expect(count(page)).toHaveText('1');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const [command] = (await draft(page)).intent.request.commands;
    expect(command).toMatchObject({ kind: 'assign', destination: { slot: { id: 'slot-g' } } });
    await harness.expectNoHorizontalOverflow();
    await harness.expectScrollUnlocked();
    expect(writes).toEqual([]);
  });

  test('several cards picked at once fill the empty pockets on the page in one save', async ({ harness }) => {
    const { page } = harness;
    const dialog = await search(page, 'slot-g', 'synthetic');
    await dialog.getByRole('button', { name: 'Pick several', exact: true }).click();
    await expect(dialog).toContainText('0 of 3 empty pockets on this page');
    for (const name of ['Energy', 'Snorlax A', 'Trainer']) {
      await dialog.getByRole('button', { name: new RegExp(`^Pick card ${name} from `) }).click();
      await variant(page)
        .getByRole('button', { name: /^Add Normal/ })
        .click();
    }
    const energy = dialog.getByRole('button', { name: /^Pick card Energy from / });
    await expect(energy).toHaveAttribute('aria-pressed', 'true');
    const add = dialog.getByRole('button', { name: 'Add 3 cards to this page', exact: true });
    await harness.expectWithinSafeViewport(add);
    await harness.expectMinTapTarget(add, 36);
    await harness.expectNoHorizontalOverflow();
    await expect(count(page)).toHaveText('0');
    await add.click();
    await expect(count(page)).toHaveText('1');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // From the tapped pocket: Energy in the free pocket, Snorlax in its Pokémon pocket, Trainer in the pocket kept for it.
    const placed = Object.fromEntries(
      (await draft(page)).intent.request.commands
        .filter((c: { kind: string }) => c.kind === 'assign')
        .map((c: { destination: { slot: { id: string } }; selection: { inventoryItemId: string } }) => [
          c.destination.slot.id,
          c.selection.inventoryItemId,
        ]),
    );
    expect(Object.keys(placed).sort()).toEqual(['slot-e', 'slot-f', 'slot-g']);
    await harness.expectScrollUnlocked();
  });

  test('a pocket kept for one printing shows that printing in the selector and saves it', async ({ harness }) => {
    const { page } = harness;
    await pocket(page, 'slot-f').click();
    const dialog = selector(page);
    await expect(details(page)).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: 'Add Trainer', exact: true })).toHaveCount(1);
    // Only the reserved printing is offered, so a card that doesn't fit can't be picked for it.
    await expect(tile(dialog, 'Trainer')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^Add card / })).toHaveCount(1);
    await expect(dialog.getByRole('searchbox', { name: 'Search cards' })).toBeHidden();
    await tile(dialog, 'Trainer').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await expect(count(page)).toHaveText('1');
    await expect(pocket(page, 'slot-f')).toHaveAccessibleName('Trainer, Owned');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a failed save keeps the exact draft and Try again resends it', async ({ harness }) => {
    const { page } = harness;
    await expect(pocket(page, 'slot-g')).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event('synthetic-layout-reject-once')));
    const dialog = await search(page, 'slot-g', 'Trainer');
    await tile(dialog, 'Trainer').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    const failed = sheet(page, "Couldn't add this card");
    await expect(failed.getByRole('alert')).toBeVisible();
    await expect(failed).not.toContainText(/storage|draft/i);
    await harness.expectWithinSafeViewport(failed.getByRole('button').last());
    for (const action of await failed.locator('button:visible').all()) await harness.expectMinTapTarget(action, 36);
    const rejected = JSON.parse((await page.getByLabel('Synthetic rejected draft').textContent()) ?? 'null');
    await failed.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(count(page)).toHaveText('1');
    const saved = await draft(page);
    expect(saved.intent.request.operationId).toBe(rejected.intent.request.operationId);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('what a pocket is kept for is changed in layout editing: a Pokémon, any card, and taking a card out', async ({
    harness,
  }) => {
    const { page } = harness;
    // The card's details never offer target controls.
    await pocket(page, 'slot-a').click();
    await expect(details(page).getByRole('button', { name: /target|Unassigned/i })).toHaveCount(0);
    await harness.closeControl(details(page)).click();
    await editLayout(page);
    let menu = await pocketOptions(page, 'slot-e');
    await menu.getByRole('menuitem', { name: 'Change what goes here' }).click();
    const reserve = sheet(page, 'What goes in this pocket?');
    await reserve.getByRole('button', { name: /^A Pokémon/ }).click();
    const which = sheet(page, 'Which Pokémon?');
    await which.getByRole('searchbox', { name: 'Search Pokémon' }).fill('pikachu');
    await which.getByRole('button', { name: /^Pikachu/ }).click();
    await expect(count(page)).toHaveText('1');
    expect((await draft(page)).intent.request.commands[0]).toMatchObject({
      kind: 'update',
      slot: { id: 'slot-e' },
      target: { kind: 'pokemon', pokemonId: 25 },
    });
    await expect(pocket(page, 'slot-e')).toHaveAccessibleName('Pikachu, Unfilled target');
    await bar(page).getByRole('button', { name: 'More pocket options', exact: true }).click();
    await bar(page).getByRole('menuitem', { name: 'Let any card go here' }).click();
    await expect(count(page)).toHaveText('2');
    await expect(pocket(page, 'slot-e')).toHaveAccessibleName('Free slot, Empty spacer');
    // Deselect it, then take the card out of an owned pocket: the pocket keeps what it is for.
    await pocket(page, 'slot-e').click();
    menu = await pocketOptions(page, 'slot-b');
    await menu.getByRole('menuitem', { name: /Take the card out/ }).click();
    await expect(count(page)).toHaveText('3');
    expect((await draft(page)).intent.request.commands[0]).toMatchObject({ kind: 'clear' });
  });

  test('recorded Raw and grade choices retain item IDs without leaking certificate or labels', async ({ harness }) => {
    const { page } = harness;
    const dialog = await search(page, 'slot-g', 'Snorlax A');
    await tile(dialog, 'Snorlax A').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    const copy = sheet(page, 'Which copy?');
    await expect(copy.getByRole('button', { name: 'Use my raw copy', exact: true })).toBeVisible();
    await expect(copy).not.toContainText('PRIVATE');
    await copy.getByRole('button', { name: 'Use my PSA 9', exact: true }).click();
    await expect(page.getByLabel('Synthetic latest draft')).toContainText('unassigned-grade');
    await expect(count(page)).toHaveText('1');
    await expect(page.getByText('PRIVATE')).toHaveCount(0);
  });

  test('cached non-dex cards cannot suppress legacy offline Pokemon corrections', async ({ harness, context }) => {
    const { page } = harness;
    // Complete a real interaction before using the effect-installed keyboard shortcut.
    await pocket(page, 'slot-g').click();
    await harness.closeControl(selector(page)).click();
    await expect(selector(page)).toHaveCount(0);
    await page.keyboard.press('Control+k');
    const quick = page.getByRole('dialog', { name: 'Quick mode' });
    await expect(quick).toBeVisible();
    await quick.getByRole('button', { name: 'Close quick mode', exact: true }).click();
    const fixture = syntheticSlotPickerSnapshot().cards;
    const cards = [
      { ...fixture[0], name: 'Bulbasaur', dexIds: [1] },
      { ...fixture[2], name: 'Bulbasaurr', dexIds: [] },
    ];
    await page.evaluate(async (cards) => {
      const cache = await caches.open('synthetic-picker-data');
      await cache.put(
        '/app/api/tcg-card-search?q=bulbasaurr&includeNonPokemon=1',
        new Response(JSON.stringify({ cards }), { headers: { 'content-type': 'application/json' } }),
      );
    }, cards);
    await context.setOffline(true);
    await page.keyboard.press('Control+k');
    await expect(quick).toBeVisible();
    await quick.getByRole('searchbox').fill('synthetic bulbasaurr');
    await expect(quick.getByRole('button', { name: /^Bulbasaur, Synthetic set/ })).toBeVisible();
    await expect(quick.getByRole('status').filter({ hasText: 'Showing cards for' })).toContainText('bulbasaur');
    await context.setOffline(false);
  });

  test('offline, the selector finds only cards saved on this device and never guesses their language', async ({
    harness,
    context,
  }) => {
    const { page } = harness;
    const energy = { ...syntheticSlotPickerSnapshot().cards.find((c) => c.name === 'Energy')!, language: undefined };
    await page.evaluate(async (card) => {
      const cache = await caches.open('synthetic-picker-data');
      await cache.put(
        '/app/api/tcg-card-search?q=energy',
        new Response(JSON.stringify({ cards: [card] }), { headers: { 'content-type': 'application/json' } }),
      );
    }, energy);
    // Warm the dynamically loaded selector before disconnecting.
    await pocket(page, 'slot-g').click();
    await expect(selector(page)).toBeVisible();
    await context.setOffline(true);
    await expect(selector(page)).toHaveCount(0);
    const dialog = await search(page, 'slot-g', 'uncached');
    await expect(dialog).toContainText("You're offline");
    await expect(dialog).toContainText('Only cards already saved on this device can be found offline');
    await dialog.getByRole('searchbox', { name: 'Search cards' }).fill('Energy');
    await tile(dialog, 'Energy').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await expect(count(page)).toHaveText('1');
    // Unknown language stays unknown, never guessed.
    expect((await draft(page)).intent.request.commands[0].selection.identity.language).toBeUndefined();
    await context.setOffline(false);
  });

  test('every dismissal of the what-goes-here chooser cancels above the dock without drafts', async ({ harness }) => {
    const { page } = harness;
    await editLayout(page);
    await pocket(page, 'slot-e').click();
    const open = async () => {
      await bar(page).getByRole('button', { name: 'More pocket options', exact: true }).click();
      await bar(page).getByRole('menuitem', { name: 'Change what goes here' }).click();
      const dialog = sheet(page, 'What goes in this pocket?');
      await expect(dialog).toBeVisible();
      // The sheet itself reaches the bottom edge; its choices sit above the home indicator.
      await harness.expectWithinSafeViewport(dialog.getByRole('button').last());
      return dialog;
    };
    let dialog = await open();
    await dialog.getByRole('button', { name: 'Back to cards', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await page.evaluate(() => window.history.back());
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toContain('e2e-harness');
    dialog = await open();
    await harness.tapBackdrop(dialog);
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await harness.swipeDown(dialog);
    await expect(dialog).toHaveCount(0);
    await expect(count(page)).toHaveText('0');
    await harness.expectScrollUnlocked();
    await harness.expectNoHorizontalOverflow();
  });

  test('single-finish selection saves at once, an unplaced raw copy is reused by explicit choice', async ({
    harness,
  }) => {
    const { page } = harness;
    const card = {
      ...syntheticSlotPickerSnapshot().cards.find((c) => c.name === 'Energy')!,
      variants: { normal: true },
    };
    await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards: [card] } }));
    let dialog = await search(page, 'slot-g', 'Energy');
    await tile(dialog, 'Energy').click();
    await expect(count(page)).toHaveText('1');
    await expect(variant(page)).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.unroute('**/app/api/tcg-card-search**');
    const snorlax = syntheticSlotPickerSnapshot().cards[0];
    await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards: [snorlax] } }));
    // The owned pocket's card details can still take the card out, which frees the pocket again.
    await pocket(page, 'slot-g').click();
    await details(page).getByRole('button', { name: 'More card options' }).click();
    await details(page)
      .getByRole('menuitem', { name: /Take out of this pocket/ })
      .click();
    await expect(count(page)).toHaveText('2');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    dialog = await search(page, 'slot-g', 'Snorlax');
    await tile(dialog, 'Snorlax A').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await sheet(page, 'Which copy?').getByRole('button', { name: 'Use my raw copy', exact: true }).click();
    await expect(page.getByLabel('Synthetic latest draft')).toContainText('unassigned-a');
    await expect(count(page)).toHaveText('3');
  });

  test('provider-confirmed finish and requested catalog language survive selection', async ({ harness }) => {
    const { page } = harness;
    // Synthetic Japanese catalog record and provider-confirmed standard finish quotes.
    const card = { ...syntheticSlotPickerSnapshot().cards[2], language: 'ja', variants: { normal: true } };
    const requested: string[] = [];
    await page.route('**/app/api/tcg-card-search**', (route) => {
      requested.push(new URL(route.request().url()).searchParams.get('language') ?? 'missing');
      return route.fulfill({ json: { cards: [card] } });
    });
    await page.route('**/app/api/card-prices', (route) =>
      route.fulfill({
        json: {
          prices: [
            {
              cardId: card.id,
              language: 'ja',
              gbpAmount: 1,
              updatedAt: '2026-11-09T00:00:00Z',
              finishPrices: [
                { cardId: card.id, language: 'ja', finish: 'normal', variantKey: 'normal', gbpAmount: 1 },
                {
                  cardId: card.id,
                  language: 'ja',
                  finish: 'reverse_holo',
                  variantKey: 'reverse-holofoil',
                  gbpAmount: 2,
                },
              ],
            },
          ],
        },
      }),
    );
    await pocket(page, 'slot-g').click();
    const dialog = selector(page);
    await dialog.getByRole('button', { name: /Filters/ }).click();
    const filters = sheet(page, 'Filters and sort');
    await filters.getByRole('button', { name: 'Japanese', exact: true }).click();
    await filters.getByRole('button', { name: 'Close filters', exact: true }).click();
    await dialog.getByRole('searchbox', { name: 'Search cards' }).fill('Trainer');
    await tile(dialog, 'Trainer').click();
    await variant(page)
      .getByRole('button', { name: /^Add Reverse/ })
      .click();
    await expect(count(page)).toHaveText('1');
    expect((await draft(page)).intent.request.commands[0].selection.identity).toMatchObject({
      language: 'ja',
      finish: 'reverse_holo',
    });
    expect(requested).toContain('ja');
  });

  test('read-only pockets open details only, never a selector or any way to change them', async ({ harness }) => {
    const { page } = harness;
    await page.goto('/app/e2e-harness?signedIn=1&slots=picker&readOnly=1&rows=2&cols=4');
    await pocket(page, 'slot-g').click();
    await expect(details(page)).toBeVisible();
    await expect(
      details(page).getByRole('button', { name: /Choose card|More card options|Take out|Remove|Rearrange/ }),
    ).toHaveCount(0);
    await expect(selector(page)).toHaveCount(0);
    await harness.closeControl(details(page)).click();
    // An empty species pocket is read-only too: its details open, never the selector.
    await pocket(page, 'slot-e').click();
    await expect(details(page)).toContainText('Not collected');
    await expect(selector(page)).toHaveCount(0);
    await harness.closeControl(details(page)).click();
    // No pocket menu and no layout editing either.
    await pocket(page, 'slot-a').click({ button: 'right' });
    await expect(page.getByRole('dialog', { name: /pocket options$/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit layout', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
  });

  test('same-document owner and binder switches cancel unfinished selection', async ({ harness }) => {
    const { page } = harness;
    for (const kind of ['owner', 'binder']) {
      const dialog = await search(page, 'slot-g', 'Snorlax A');
      await tile(dialog, 'Snorlax A').click();
      await expect(variant(page)).toBeVisible();
      await page.evaluate(
        (kind) => window.dispatchEvent(new CustomEvent('synthetic-slot-scope-change', { detail: kind })),
        kind,
      );
      await expect(dialog).toHaveCount(0);
      await expect(variant(page)).toHaveCount(0);
      await expect(count(page)).toHaveText('0');
    }
  });

  test('long custom grading labels wrap without overflow and remain tappable', async ({ harness }) => {
    const { page } = harness;
    const name = 'CustomGrader'.repeat(16);
    await expect(pocket(page, 'slot-g')).toBeVisible();
    await expect(async () => {
      await page.evaluate(
        (name) => window.dispatchEvent(new CustomEvent('synthetic-slot-grading-change', { detail: name })),
        name,
      );
      const dialog = await search(page, 'slot-g', 'Snorlax A');
      await tile(dialog, 'Snorlax A').click();
      await variant(page)
        .getByRole('button', { name: /^Add Normal/ })
        .click();
      await expect(
        sheet(page, 'Which copy?').getByRole('button', { name: `Use my ${name} 9`, exact: true }),
      ).toBeVisible({ timeout: 2000 });
    }).toPass();
    const copy = sheet(page, 'Which copy?');
    const choice = copy.getByRole('button', { name: `Use my ${name} 9`, exact: true });
    await harness.expectMinTapTarget(choice, 36);
    expect(await copy.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await harness.expectNoHorizontalOverflow();
    await copy.getByRole('button', { name: 'Back to cards', exact: true }).click();
    await expect(copy).toHaveCount(0);
    await expect(count(page)).toHaveText('0');
  });

  test('long card and set names stay inside their tile and the variant sheet', async ({ harness }) => {
    const { page } = harness;
    const card = {
      ...syntheticSlotPickerSnapshot().cards[2],
      name: `Trainer${'X'.repeat(180)}`,
      set: { id: 'synthetic', name: 'Set'.repeat(80) },
    };
    await page.route('**/app/api/tcg-card-search**', (route) => route.fulfill({ json: { cards: [card] } }));
    const dialog = await search(page, 'slot-g', 'Trainer');
    const hit = dialog.getByRole('button', { name: /^Add card Trainer/ });
    await expect(hit).toBeVisible();
    await harness.expectMinTapTarget(hit, 36);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await harness.expectNoHorizontalOverflow();
    await hit.click();
    expect(await variant(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await variant(page).getByRole('button', { name: 'Back to cards', exact: true }).click();
    await expect(count(page)).toHaveText('0');
  });

  test('a pocket is kept for one exact card in layout editing, without creating ownership', async ({ harness }) => {
    const { page } = harness;
    await editLayout(page);
    const menu = await pocketOptions(page, 'slot-g');
    await menu.getByRole('menuitem', { name: 'Choose what goes here' }).click();
    await sheet(page, 'What goes in this pocket?')
      .getByRole('button', { name: /^One exact card/ })
      .click();
    const dialog = selector(page);
    await dialog.getByRole('searchbox', { name: 'Search cards' }).fill('Trainer');
    await tile(dialog, 'Trainer').click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await expect(count(page)).toHaveText('1');
    const [command] = (await draft(page)).intent.request.commands;
    expect(command).toMatchObject({
      kind: 'update',
      slot: { id: 'slot-g' },
      target: { kind: 'card', finish: 'normal' },
    });
    await expect(pocket(page, 'slot-g')).toHaveAccessibleName('Trainer, Unfilled target');
  });

  test("the binder filter starts on the binder's languages and warns once widened", async ({ harness }) => {
    const { page } = harness;
    // Synthetic: one extra Snorlax printing that only exists in Japanese; the harness binder keeps English.
    const [first] = snorlaxList();
    await routeSnorlax(page, [
      ...snorlaxList(),
      { ...first, id: 'synthetic-snorlax-jp', name: 'Kabigon', languages: ['ja'] },
    ]);
    await pocket(page, 'slot-e').click();
    const dialog = selector(page);
    await expect(tile(dialog, 'Snorlax A')).toBeVisible();
    await expect(tile(dialog, 'Kabigon')).toHaveCount(0);
    await expect(dialog.getByText('Your filters don’t match this binder’s settings.')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Binder filter' }).click();
    await page.getByRole('menuitemradio', { name: 'All cards' }).click();
    await expect(tile(dialog, 'Kabigon')).toBeVisible();
    await expect(dialog.getByText('Your filters don’t match this binder’s settings.')).toBeVisible();
    await harness.expectNoHorizontalOverflow();

    // A card filter, so it resets when the selector opens again.
    await dialog.getByRole('button', { name: 'Close card selector' }).click();
    await pocket(page, 'slot-e').click();
    await expect(tile(selector(page), 'Snorlax A')).toBeVisible();
    await expect(tile(selector(page), 'Kabigon')).toHaveCount(0);
  });

  test('an empty species pocket opens the card selector directly, already showing that species', async ({
    harness,
  }) => {
    const { page } = harness;
    await routeSnorlax(page);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (/\/api\/(inventory|binder-slots|collection)(\?|$)/.test(r.url()) && r.method() !== 'GET')
        writes.push(r.url());
    });
    await page.locator('button[data-slot-id="slot-e"]').click();
    const dialog = selector(page);
    await expect(dialog.getByRole('button', { name: 'Add card Snorlax A from Synthetic set' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Add card Snorlax B from Synthetic set' })).toBeVisible();
    await expect(details(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Choose card', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit slot', exact: true })).toHaveCount(0);
    await expect(dialog.getByText('Unfilled target')).toHaveCount(0);
    // Wanted mode and "mark owned without card" are legacy collection writes, so a native pocket never shows them.
    await expect(dialog.getByRole('group', { name: 'Picker mode' })).toHaveCount(0);
    await expect(dialog.getByRole('heading', { name: /Add card for Snorlax/ })).toHaveCount(1);
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectMinTapTarget(harness.closeControl(dialog), 36);
    await harness.expectHittable(harness.closeControl(dialog));
    await harness.expectNoHorizontalOverflow();
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
    expect(writes).toEqual([]);
  });

  test('selecting a species card saves the same slot-scoped assign and closes the selector', async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await page.locator('button[data-slot-id="slot-e"]').click();
    const dialog = selector(page);
    await dialog.getByRole('button', { name: 'Add card Snorlax B from Synthetic set' }).click();
    // Normal and holo both exist, so the finish is asked and never guessed. Nothing is saved before the choice.
    await expect(count(page)).toHaveText('0');
    await variant(page)
      .getByRole('button', { name: /^Add Holo/ })
      .click();
    await expect(count(page)).toHaveText('1');
    await expect(dialog).toHaveCount(0);
    await expect(details(page)).toHaveCount(0);
    const latest = await draft(page);
    expect(latest.scope).toEqual({
      ownerUserId: 'synthetic-owner',
      collectionId: '00000000-0000-4000-8000-000000000366',
      slotId: 'slot-e',
    });
    const [command] = latest.intent.request.commands;
    expect(command).toMatchObject({
      kind: 'assign',
      occupied: 'cancel',
      fulfillWant: null,
      destination: {
        slot: { id: 'slot-e', version: 1, inventoryItemId: null, itemVersion: null, placementVersion: null },
      },
    });
    expect(command.selection).toMatchObject({
      kind: 'catalog',
      identity: { kind: 'card', cardId: 'synthetic-snorlax-b', language: 'en', finish: 'holo' },
    });
    await expect(page.locator('button[data-slot-id="slot-e"]')).toHaveAccessibleName('Snorlax B, Owned');
    await harness.expectScrollUnlocked();
  });

  test("a selector pick with a graded copy asks which copy in the picker's sheet", async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await page.locator('button[data-slot-id="slot-e"]').click();
    await selector(page).getByRole('button', { name: 'Add card Snorlax A from Synthetic set' }).click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    // The synthetic owner holds an unplaced raw copy and an unplaced PSA 9 copy of this printing.
    const copy = sheet(page, 'Which copy?');
    await expect(copy.getByRole('button', { name: 'Use my raw copy', exact: true })).toBeVisible();
    await expect(copy.getByRole('button', { name: 'Use my PSA 9', exact: true })).toBeVisible();
    await expect(details(page)).toHaveCount(0);
    await harness.expectWithinSafeViewport(copy.getByRole('button').last());
    for (const action of await copy.locator('button:visible').all()) await harness.expectMinTapTarget(action, 36);
    await expect(count(page)).toHaveText('0');
    await harness.swipeDown(copy);
    await expect(copy).toHaveCount(0);
    await expect(selector(page)).toBeVisible();
    await expect(count(page)).toHaveText('0');
    await selector(page).getByRole('button', { name: 'Add card Snorlax A from Synthetic set' }).click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await sheet(page, 'Which copy?').getByRole('button', { name: 'Use my PSA 9', exact: true }).click();
    await expect(count(page)).toHaveText('1');
    await expect(selector(page)).toHaveCount(0);
    expect((await draft(page)).intent.request.commands[0].selection).toMatchObject({
      kind: 'existing',
      inventoryItemId: 'unassigned-grade',
    });
  });

  // Synthetic exact want on the empty Snorlax target: Snorlax A, English, normal.
  const addWant = async (page: import('@playwright/test').Page) => {
    // The listener installs on hydration, so repeat until the harness reports the want.
    await expect(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new CustomEvent('synthetic-slot-wants', {
            detail: [{ card_id: 'synthetic-snorlax-a', card_language: 'en', card_finish: 'normal' }],
          }),
        ),
      );
      await expect(page.getByLabel('Synthetic want count')).toHaveText('1', { timeout: 500 });
    }).toPass();
  };

  test('a pick that matches a slot want asks before fulfilling it, and fulfils only on that choice', async ({
    harness,
  }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await addWant(page);
    await page.locator('button[data-slot-id="slot-e"]').click();
    await selector(page).getByRole('button', { name: 'Add card Snorlax A from Synthetic set' }).click();
    await variant(page)
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    const copy = sheet(page, 'Which copy?');
    const want = copy.getByRole('button', { name: /^Found my wanted Snorlax A/ });
    await expect(want).toHaveAttribute('aria-pressed', 'false');
    await expect(count(page)).toHaveText('0');
    await want.click();
    await copy.getByRole('button', { name: 'Use my raw copy', exact: true }).click();
    await expect(count(page)).toHaveText('1');
    const [command] = (await draft(page)).intent.request.commands;
    expect(command.fulfillWant).toMatchObject({
      index: 0,
      expected: { card_id: 'synthetic-snorlax-a', card_language: 'en', card_finish: 'normal' },
    });
    expect(command.destination.slot.id).toBe('slot-e');
  });

  test('a pick that matches no slot want saves without fulfilling anything', async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await addWant(page);
    await page.locator('button[data-slot-id="slot-e"]').click();
    await selector(page).getByRole('button', { name: 'Add card Snorlax B from Synthetic set' }).click();
    await page
      .getByRole('dialog', { name: 'Which variant?' })
      .getByRole('button', { name: /^Add Normal/ })
      .click();
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('1');
    expect((await draft(page)).intent.request.commands[0].fulfillWant).toBeNull();
  });

  test('the selector has no structural controls; they live in layout editing', async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await pocket(page, 'slot-e').click();
    const dialog = selector(page);
    await expect(dialog.getByRole('button', { name: 'Add card Snorlax A from Synthetic set' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'More options', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Edit slot|Change target|Remove target/ })).toHaveCount(0);
    await harness.closeControl(dialog).click();
    await editLayout(page);
    // In layout editing a tap selects the pocket on the page; it opens neither the selector nor a form.
    const menu = await pocketOptions(page, 'slot-e');
    await expect(selector(page)).toHaveCount(0);
    await expect(details(page)).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Let any card go here' }).click();
    await expect(count(page)).toHaveText('1');
    await expect(pocket(page, 'slot-e')).toHaveAccessibleName('Free slot, Empty spacer');
    await bar(page).getByRole('button', { name: 'Done', exact: true }).click();
    await harness.expectScrollUnlocked();
  });

  test('the species selector dismisses by X, Escape, back and backdrop without saving', async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    const open = async () => {
      await pocket(page, 'slot-e').click();
      const dialog = selector(page);
      await expect(dialog.getByRole('button', { name: 'Add card Snorlax A from Synthetic set' })).toBeVisible();
      return dialog;
    };
    await test.step('X', async () => {
      const d = await open();
      await harness.closeControl(d).click();
      await expect(d).toHaveCount(0);
      return d;
    });
    await test.step('Escape', async () => {
      const d = await open();
      await page.keyboard.press('Escape');
      await expect(d).toHaveCount(0);
      return d;
    });
    await test.step('back', async () => {
      const d = await open();
      await page.evaluate(() => window.history.back());
      await expect(d).toHaveCount(0);
      expect(page.url()).toContain('e2e-harness');
      return d;
    });
    await test.step('backdrop', async () => {
      const d = await open();
      await harness.tapBackdrop(d);
      await expect(d).toHaveCount(0);
      return d;
    });
    await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
    await expect(pocket(page, 'slot-e')).toHaveAccessibleName('Snorlax, Unfilled target');
    await harness.expectScrollUnlocked();
  });

  test('an owner or binder switch closes the open selector and never retargets', async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    for (const kind of ['owner', 'binder']) {
      await pocket(page, 'slot-e').click();
      const dialog = selector(page);
      await expect(dialog.getByRole('button', { name: 'Add card Snorlax A from Synthetic set' })).toBeVisible();
      await page.evaluate(
        (kind) => window.dispatchEvent(new CustomEvent('synthetic-slot-scope-change', { detail: kind })),
        kind,
      );
      await expect(dialog).toHaveCount(0);
      await expect(page.getByLabel('Synthetic draft count')).toHaveText('0');
    }
  });

  test('a free pocket opens the visual selector ready to search, and every dismissal cancels', async ({ harness }) => {
    const { page } = harness;
    const open = async () => {
      await pocket(page, 'slot-g').click();
      const dialog = selector(page);
      await expect(dialog.getByRole('searchbox', { name: 'Search cards' })).toBeVisible();
      return dialog;
    };
    let dialog = await open();
    await expect(dialog.getByRole('heading', { name: 'Add a card', exact: true })).toHaveCount(1);
    await expect(dialog).toContainText('Search for a card');
    await expect(dialog.getByText(/Empty slot|Empty spacer|Unfilled target|Edit slot|Set target/)).toHaveCount(0);
    await expect(details(page)).toHaveCount(0);
    await harness.expectWithinSafeViewport(dialog);
    await harness.expectNoHorizontalOverflow();
    await harness.closeControl(dialog).click();
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await page.evaluate(() => window.history.back());
    await expect(dialog).toHaveCount(0);
    dialog = await open();
    await harness.tapBackdrop(dialog);
    await expect(dialog).toHaveCount(0);
    await expect(count(page)).toHaveText('0');
    await harness.expectScrollUnlocked();
  });

  test("an owned pocket opens the card's details and never the selector", async ({ harness }) => {
    const { page } = harness;
    await routeSnorlax(page);
    await pocket(page, 'slot-a').click();
    await expect(details(page).getByRole('heading', { name: 'Snorlax A', exact: true })).toBeVisible();
    await expect(selector(page)).toHaveCount(0);
    await expect(details(page).getByRole('searchbox')).toHaveCount(0);
  });
});
