import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  browserHostCatalog,
  browserHostDisplayCatalog,
  browserHostSlotDisplay,
} from '@/lib/collection/browser-host-catalog';
import type { CardLanguage } from '@/lib/domain/cards';
import type { InventoryCatalogEvidence } from '@/lib/domain/inventory-browse';
import { inventoryBrowseCatalog } from './fixtures/inventory-browse';
import { parseNavigationEvidence } from '@/lib/collection/inventory-read-transport';
import { inventoryBrowseFixture, inventoryBrowseLayouts } from './fixtures/inventory-browse';

describe('browser host catalog', () => {
  test('old display names cannot invent target membership', () => {
    assert.equal(browserHostCatalog(inventoryBrowseCatalog)('base1-4'), undefined);
  });
  test('translated metadata retains one printing and actual mirror dex identities', () => {
    const en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] };
    const fr = { ...en, card: { ...en.card, name: 'Dracaufeu', language: 'fr' as const } };
    assert.deepEqual(browserHostCatalog([en, fr])('base1-4')?.pokemonIds, [6]);
    assert.equal(browserHostCatalog([en, { ...fr, pokemonIds: [143] }])('base1-4'), undefined);
  });
  test('wire and device metadata preserve real dex links and reject malformed links', () => {
    const snapshot = inventoryBrowseFixture();
    const evidence = { layouts: inventoryBrowseLayouts, catalog: [{ ...inventoryBrowseCatalog[0], pokemonIds: [6] }] };
    assert.deepEqual(parseNavigationEvidence(evidence, snapshot)?.catalog[0].pokemonIds, [6]);
    for (const pokemonIds of [[0], [6, 6], ['6'], [-1], [1.5]])
      assert.equal(
        parseNavigationEvidence({ ...evidence, catalog: [{ ...evidence.catalog[0], pokemonIds }] }, snapshot),
        undefined,
      );
  });
});

test('host display resolves each recorded language and rejects ambiguous aliases', async () => {
  const { buildSlotDisplay } = await import('@/lib/binder-display-model');
  const snapshot = inventoryBrowseFixture();
  snapshot.items[1].identity = { kind: 'card', cardId: 'base1-4', language: 'ja', finish: 'holo' };
  const en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] };
  const ja = { ...en, card: { ...en.card, name: 'Synthetic Japanese title', language: 'ja' as const } };
  const resolve = browserHostDisplayCatalog([en, ja]);
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, resolve)[9].card?.name, en.card.name);
  assert.equal(buildSlotDisplay(snapshot.binders[1], snapshot, resolve)[9].card?.name, ja.card.name);
  assert.equal(resolve('base1-4', 'fr'), undefined);
  const ambiguous = browserHostDisplayCatalog([
    en,
    { ...en, card: { ...en.card, id: 'other-printing', aliasIds: ['base1-4'], name: 'Ambiguous title' } },
  ]);
  assert.equal(ambiguous('base1-4', 'en'), undefined);
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, ambiguous)[9].card?.name, 'base1-4');
  const target = snapshot.binders[0].slots[0];
  target.target = { kind: 'card', cardId: 'base1-4', language: 'ja' };
  assert.equal(buildSlotDisplay(snapshot.binders[0], snapshot, resolve)[0].card?.name, ja.card.name);
});

// The pre-index resolvers (whole-catalog filter per lookup), kept verbatim as the differential oracle.
function scanCatalog(evidence: readonly InventoryCatalogEvidence[]) {
  return (id: string) => {
    const matches = evidence.filter(
      (c) => c.card.id === id || c.card.canonicalId === id || c.card.aliasIds?.includes(id),
    );
    const first = matches[0];
    if (
      !first ||
      !first.pokemonIds ||
      matches.some(
        (c) =>
          c.card.id !== first.card.id ||
          !c.pokemonIds ||
          c.card.canonicalId !== first.card.canonicalId ||
          JSON.stringify(c.card.aliasIds ?? []) !== JSON.stringify(first.card.aliasIds ?? []) ||
          JSON.stringify(c.pokemonIds) !== JSON.stringify(first.pokemonIds),
      )
    )
      return undefined;
    return {
      kind: 'card',
      id: first.card.id,
      canonicalId: first.card.canonicalId,
      aliasIds: first.card.aliasIds,
      pokemonIds: first.pokemonIds,
    };
  };
}
function scanDisplayCatalog(evidence: readonly InventoryCatalogEvidence[]) {
  return (id: string, language?: CardLanguage) => {
    const matches = evidence.filter(
      (c) => c.card.id === id || c.card.canonicalId === id || c.card.aliasIds?.includes(id),
    );
    const first = matches[0];
    if (
      !first ||
      matches.some(
        (c) =>
          c.card.id !== first.card.id ||
          c.card.canonicalId !== first.card.canonicalId ||
          JSON.stringify(c.card.aliasIds ?? []) !== JSON.stringify(first.card.aliasIds ?? []),
      )
    )
      return undefined;
    const translated = language ? matches.filter((c) => c.card.language === language) : matches;
    return translated.length === 1 ? translated[0].card : undefined;
  };
}

describe('indexed host catalog matches the whole-catalog scan', () => {
  // Synthetic rows only. Each covers one identity shape the scan distinguishes.
  const row = (
    id: string,
    extra: Partial<InventoryCatalogEvidence['card']> = {},
    pokemonIds: number[] | null = [6],
  ): InventoryCatalogEvidence => ({
    card: {
      id,
      name: `Synthetic ${id}`,
      localId: '1',
      language: 'en',
      set: { id: 'synthetic', name: 'Synthetic set' },
      ...extra,
    },
    speciesNames: [],
    ...(pokemonIds ? { pokemonIds } : {}),
  });
  const catalog: InventoryCatalogEvidence[] = [
    row('own'),
    row('canon-row', { canonicalId: 'canon' }),
    row('alias-row', { aliasIds: ['alias-a', 'alias-b', 'alias-a'] }),
    row('self-canon', { canonicalId: 'self-canon', aliasIds: ['self-canon'] }),
    row('lang', { language: 'en' }),
    row('lang', { language: 'ja', name: 'Synthetic ja' }),
    row('lang', { language: 'fr', name: 'Synthetic fr' }),
    row('lang-dup', { language: 'en' }),
    row('lang-dup', { language: 'en', name: 'Synthetic second en' }),
    row('identical'),
    row('identical'),
    row('conflict-dex', {}, [6]),
    row('conflict-dex', {}, [143]),
    row('no-dex', {}, null),
    row('half-dex'),
    row('half-dex', {}, null),
    row('shared-alias-1', { aliasIds: ['shared'] }),
    row('shared-alias-2', { aliasIds: ['shared'] }),
    row('canon-conflict', { canonicalId: 'c1' }),
    row('canon-conflict', { canonicalId: 'c2' }),
    row('alias-order', { aliasIds: ['x', 'y'] }),
    row('alias-order', { aliasIds: ['y', 'x'] }),
    row('alias-missing', { aliasIds: ['z'] }),
    row('alias-missing'),
    row('own-vs-canon'),
    row('other', { canonicalId: 'own-vs-canon' }),
    row('multi-dex', {}, [29, 32]),
    row('multi-dex', { language: 'ja' }, [29, 32]),
  ];
  const ids = [
    ...new Set(
      catalog
        .flatMap((c) => [c.card.id, c.card.canonicalId, ...(c.card.aliasIds ?? [])])
        .filter((id): id is string => typeof id === 'string'),
    ),
    'missing',
    '',
  ];
  const languages: (CardLanguage | undefined)[] = [undefined, 'en', 'ja', 'fr', 'de'];

  test('own, canonical, alias, language, duplicate, conflicting and missing lookups', () => {
    for (const evidence of [catalog, [...catalog].reverse(), []]) {
      const indexed = browserHostCatalog(evidence),
        scanned = scanCatalog(evidence);
      const indexedDisplay = browserHostDisplayCatalog(evidence),
        scannedDisplay = scanDisplayCatalog(evidence);
      for (const id of ids) {
        assert.deepEqual(indexed(id), scanned(id), id);
        for (const language of languages)
          assert.equal(indexedDisplay(id, language), scannedDisplay(id, language), `${id}:${language}`);
      }
    }
    // Spot-check the rules the oracle encodes, so a shared mistake cannot pass silently.
    const resolve = browserHostCatalog(catalog),
      display = browserHostDisplayCatalog(catalog);
    assert.equal(resolve('canon')?.id, 'canon-row');
    assert.equal(resolve('alias-a')?.id, 'alias-row');
    assert.equal(resolve('identical')?.id, 'identical');
    for (const id of [
      'conflict-dex',
      'no-dex',
      'half-dex',
      'shared',
      'canon-conflict',
      'alias-order',
      'alias-missing',
      'own-vs-canon',
      'missing',
    ])
      assert.equal(resolve(id), undefined, id);
    assert.equal(display('lang', 'ja')?.name, 'Synthetic ja');
    assert.equal(display('lang'), undefined);
    assert.equal(display('lang-dup', 'en'), undefined);
    assert.equal(display('identical', 'en'), undefined);
    assert.equal(display('multi-dex', 'ja')?.language, 'ja');
  });

  test('a replaced catalog gets a new answer; the index is per resolver', () => {
    const before = browserHostDisplayCatalog(catalog);
    assert.equal(before('own', 'en')?.name, 'Synthetic own');
    const replaced = catalog.map((c) => (c.card.id === 'own' ? row('own', { name: 'Synthetic renamed' }) : c));
    assert.equal(browserHostDisplayCatalog(replaced)('own', 'en')?.name, 'Synthetic renamed');
    assert.equal(browserHostCatalog([...catalog, row('own', {}, [143])])('own'), undefined);
    assert.equal(before('own', 'en')?.name, 'Synthetic own');
  });
});

describe('host slot display identity', () => {
  test('the same catalog, snapshot and binder reuse one display input; a new catalog or snapshot does not', () => {
    const snapshot = inventoryBrowseFixture(),
      en = { ...inventoryBrowseCatalog[0], pokemonIds: [6] };
    const displayFor = browserHostSlotDisplay([en]);
    const first = displayFor(snapshot, snapshot.binders[0]);
    // Unrelated host renders pass the same objects again.
    assert.equal(displayFor(snapshot, snapshot.binders[0]), first);
    assert.equal(displayFor(snapshot, snapshot.binders[0]).resolveCard, first.resolveCard);
    assert.equal(first.resolveCard?.('base1-4', 'en')?.name, en.card.name);
    // Switching binders, or a fresh snapshot of the same data, builds a new input with the same resolver.
    const other = displayFor(snapshot, snapshot.binders[1]);
    assert.notEqual(other, first);
    assert.equal(other.resolveCard, first.resolveCard);
    const fresh = structuredClone(snapshot);
    assert.notEqual(displayFor(fresh, fresh.binders[0]), first);
    // A new catalog (the host memoizes one per read.catalog) resolves the new evidence.
    const renamed = browserHostSlotDisplay([{ ...en, card: { ...en.card, name: 'Synthetic renamed' } }])(
      snapshot,
      snapshot.binders[0],
    );
    assert.notEqual(renamed.resolveCard, first.resolveCard);
    assert.equal(renamed.resolveCard?.('base1-4', 'en')?.name, 'Synthetic renamed');
  });
});
