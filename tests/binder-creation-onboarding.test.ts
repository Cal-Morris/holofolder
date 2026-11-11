import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankPageLimit,
  BLANK_PAGES,
  clampBlankPages,
  creationSummary,
  customPageSize,
  isFreePageSize,
  previewArt,
  shouldOfferBinderOnboarding,
  wizardSteps,
  type PreviewCard,
} from '@/lib/binder-creation-wizard';
import { blankPreset } from '@/lib/binder-creation-draft';

const owner = 'owner-1';
const empty = { ownerUserId: owner, items: [], collections: [{ id: 'c1' }], binders: [{ slots: [] }] } as never;
const withChange = (change: object) => ({ ...(empty as object), ...change }) as never;

describe('binder creation wizard steps', () => {
  test('leaves out steps with nothing to choose', () => {
    assert.deepEqual(wizardSteps('set'), ['kind', 'scope', 'extras', 'layout', 'preview']);
    assert.deepEqual(wizardSteps('national'), ['kind', 'layout', 'preview']);
    assert.deepEqual(wizardSteps('blank'), ['kind', 'layout', 'preview']);
    for (const preset of ['generation', 'species', 'printings'] as const)
      assert.deepEqual(wizardSteps(preset), ['kind', 'scope', 'layout', 'preview']);
  });

  test('custom page sizes are whole numbers from 1 to 8 on each side', () => {
    assert.deepEqual(customPageSize('5', '6'), { rows: 5, cols: 6 });
    assert.deepEqual(customPageSize(8, 8), { rows: 8, cols: 8 });
    for (const [r, c] of [
      ['0', '3'],
      ['9', '3'],
      ['2.5', '3'],
      ['', '3'],
      ['x', '3'],
    ])
      assert.equal(customPageSize(r, c), null);
    assert.equal(isFreePageSize({ rows: 3, cols: 4 }), true);
    assert.equal(isFreePageSize({ rows: 5, cols: 6 }), false);
  });

  test("blank page counts stay within the binder's pocket limit", () => {
    assert.equal(blankPageLimit({ rows: 3, cols: 3 }), BLANK_PAGES.max);
    assert.equal(blankPageLimit({ rows: 8, cols: 8 }), 50);
    assert.equal(clampBlankPages(0, { rows: 3, cols: 3 }), 1);
    assert.equal(clampBlankPages(500, { rows: 3, cols: 3 }), 50);
    assert.equal(clampBlankPages(Number.NaN, { rows: 3, cols: 3 }), 1);
    assert.equal(clampBlankPages(4.4, { rows: 3, cols: 3 }), 4);
    const preset = blankPreset(3 * 9);
    assert.equal(preset.entries.length, 27);
    assert.ok(preset.entries.every((e) => e.target === null));
    assert.equal(new Set(preset.entries.map((e) => e.id)).size, 27);
    assert.equal(blankPreset().entries.length, 0);
    assert.throws(() => blankPreset(5000));
    assert.equal(creationSummary('blank', 27, { rows: 3, cols: 3 }), 'Blank · 3 pages of 9');
  });
});

describe('first-run binder onboarding', () => {
  test('offers it to an owner with nothing set up yet', () => {
    assert.equal(shouldOfferBinderOnboarding(empty, owner), true);
    assert.equal(shouldOfferBinderOnboarding(withChange({ collections: [], binders: [] }), owner), true);
    assert.equal(
      shouldOfferBinderOnboarding(
        withChange({ binders: [{ slots: [{ target: null, inventoryItemId: null, wantedCards: [] }] }] }),
        owner,
      ),
      true,
    );
  });
  test('never to a partner or a collection already in use', () => {
    assert.equal(shouldOfferBinderOnboarding(empty, 'partner'), false);
    assert.equal(shouldOfferBinderOnboarding(withChange({ items: [{}] }), owner), false);
    assert.equal(
      shouldOfferBinderOnboarding(
        withChange({
          binders: [{ slots: [{ target: { kind: 'pokemon', pokemonId: 1 }, inventoryItemId: null, wantedCards: [] }] }],
        }),
        owner,
      ),
      false,
    );
    assert.equal(
      shouldOfferBinderOnboarding(
        withChange({ binders: [{ slots: [{ target: null, inventoryItemId: null, wantedCards: [{}] }] }] }),
        owner,
      ),
      false,
    );
    assert.equal(shouldOfferBinderOnboarding(withChange({ collections: [{ id: 'a' }, { id: 'b' }] }), owner), false);
  });
});

describe('creation preview art', () => {
  const artwork = (id: number) => `art/${id}`,
    name = (id: number) => `Pokémon ${id}`;
  // Synthetic catalog evidence.
  const cards = new Map<string, PreviewCard>([
    ['with-image', { name: 'Synthetic imaged', localId: '1', image: 'https://assets.tcgdex.net/en/x/y/1', dexId: 25 }],
    ['sprite-only', { name: 'Synthetic no image', localId: '2', dexId: 133 }],
    ['trainer', { name: 'Synthetic trainer', localId: '3' }],
  ]);
  test("uses the card image, then the Pokémon's artwork, then only the name", () => {
    assert.deepEqual(previewArt({ kind: 'card', cardId: 'with-image' }, cards, artwork, name), {
      src: 'https://assets.tcgdex.net/en/x/y/1',
      card: true,
      label: 'Synthetic imaged',
      number: '1',
    });
    assert.deepEqual(previewArt({ kind: 'card', cardId: 'sprite-only' }, cards, artwork, name), {
      src: 'art/133',
      card: false,
      label: 'Synthetic no image',
      number: '2',
    });
    assert.deepEqual(previewArt({ kind: 'card', cardId: 'trainer' }, cards, artwork, name), {
      src: null,
      card: true,
      label: 'Synthetic trainer',
      number: '3',
    });
    assert.deepEqual(previewArt({ kind: 'card', cardId: 'unknown' }, cards, artwork, name), {
      src: null,
      card: true,
      label: 'Card',
      number: undefined,
    });
    assert.deepEqual(previewArt({ kind: 'pokemon', pokemonId: 6 }, cards, artwork, name), {
      src: 'art/6',
      card: false,
      label: 'Pokémon 6',
    });
    assert.equal(previewArt(null, cards, artwork, name), null);
  });
});
