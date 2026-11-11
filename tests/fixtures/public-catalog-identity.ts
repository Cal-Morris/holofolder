import assert from 'node:assert/strict';

async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-key';
  // @ts-expect-error Bun mocks stay inside this subprocess.
  const { mock } = await import('bun:test');
  mock.module('server-only', () => ({}));
  mock.module('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }));
  const cards = ['Trainer', 'Energy', 'Pokemon'].map((category, i) => ({
    id: `synthetic-global-${i}`,
    set_id: 'synthetic-set',
    series_id: 'synthetic-series',
    local_id: String(i + 1),
    name_json: { en: `Synthetic ${category}` },
    category,
    external_ids_json: {
      catalog: { canonicalId: `synthetic-global-${i}`, aliasIds: [`synthetic-alias-${i}`] },
      tcgdex: { thirdParty: { tcgplayer: 42, cardmarket: 42 } },
    },
    tcg_sets: { id: 'synthetic-set', name_json: { en: 'Synthetic set' }, official_card_count: 3, release_date: null },
  }));
  const calls: URL[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.hostname, 'synthetic.supabase.test');
    if (url.pathname.endsWith('/tcg_cards')) {
      assert.ok(!url.searchParams.get('select')!.includes('!inner'), 'generic cards must not require dex links');
      const exact = url.searchParams.get('id')?.slice(3);
      return Response.json(exact ? (cards.find((row) => row.id === exact) ?? null) : cards);
    }
    const series = url.pathname.endsWith('/tcg_series');
    assert.ok(series || url.pathname.endsWith('/tcg_sets'));
    const row = {
      id: series ? 'synthetic-series' : 'synthetic-set',
      name_json: { en: 'Synthetic group' },
      ...(series ? {} : { series_id: 'synthetic-series', official_card_count: 3, release_date: null }),
    };
    return Response.json(url.searchParams.has('id') ? row : [row]);
  };
  const { listCatalogCards, getCatalogCard, listCatalogGroups, getCatalogGroup } =
    await import('../../lib/server/operations/catalog');
  const { DEVELOPER_OPERATIONS } = await import('../../lib/developer-api/operations');
  const validate = (name: string, value: unknown) =>
    DEVELOPER_OPERATIONS.find((op) => op.name === name)!.responseSchema!.parse(value);
  const page = await listCatalogCards('');
  validate('list_cards', page);
  assert.deepEqual(
    page.data.map((card) => card.id),
    cards.map((card) => card.id),
    'existing application IDs stay unchanged',
  );
  assert.deepEqual(
    page.data.map((card) => card.category),
    ['Trainer', 'Energy', 'Pokemon'],
  );
  for (const card of page.data) {
    assert.equal(card.game, 'pokemon');
    assert.equal(card.set.game, 'pokemon');
    assert.deepEqual(
      card.externalIds,
      { tcgplayer: ['42'], cardmarket: ['42'] },
      'equal provider-local values remain separate source evidence',
    );
  }
  validate('get_card', await getCatalogCard(cards[0].id, 'en'));
  for (const kind of ['sets', 'series'] as const) {
    const groups = await listCatalogGroups(kind, '');
    validate('list_' + kind, groups);
    assert.equal(groups.data[0].game, 'pokemon');
    const detail = await getCatalogGroup(kind === 'sets' ? 'tcg_sets' : 'tcg_series', String(groups.data[0].id));
    validate(kind === 'sets' ? 'get_set' : 'get_series', detail);
    assert.equal((detail as { game: string }).game, 'pokemon');
  }
  assert.ok(calls.length > 0);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
