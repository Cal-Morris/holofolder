import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPublicBinder } from '../lib/server/public-binder'
import { syntheticPublicDatabase } from './fixtures/public-binder'

for (const identity of [{ token: 'synthetic-token' }, { username: 'synthetic-owner', binderSlug: 'mixed' }]) {
  test(`public loader authorizes and preserves exact current slots: ${JSON.stringify(identity)}`, async () => {
    const db = syntheticPublicDatabase()
    const result = await loadPublicBinder(identity, db.client)
    assert.equal(result.rows, 2)
    assert.equal(result.cols, 3)
    assert.deepEqual(result.slots.map(s => s.card?.name ?? s.pokemon?.name ?? null), ['Synthetic Snorlax', 'Synthetic Snorlax', 'Synthetic Trainer', 'Synthetic Energy', null, null, 'snorlax'])
    const json = JSON.stringify(result)
    for (const sentinel of ['PRIVATE', 'certificate', 'assetIds', 'ownerUserId', 'inventoryItemId', 'wanted_by', 'source', 'acquired', 'marketGBP', 'cost']) assert.ok(!json.includes(sentinel), sentinel)
    assert.equal(result.prices, false)
    assert.deepEqual(Object.keys(result).sort(), ['appearance', 'cols', 'name', 'prices', 'rows', 'slots'].sort())
    assert.equal(db.calls[0].table, 'token' in identity ? 'binder_shares' : 'resolve_named_binder_share')
    assert.ok(db.calls.filter(c => ['binder_slots', 'inventory_placements'].includes(c.table)).every(c => c.filters.collection_id === 'binder-allowed'))
    assert.ok(db.calls.filter(c => c.table === 'inventory_items').every(c => Array.isArray(c.filters.id)))
  })
}

test('revoked or disabled identities never perform privileged binder reads', async () => {
  const db = syntheticPublicDatabase({ disabled: true })
  await assert.rejects(loadPublicBinder({ token: 'synthetic-token' }, db.client))
  assert.deepEqual(db.calls.map(c => c.table), ['binder_shares'])
})

test('revocation or rename during reading discards the whole projection', async () => {
  for (const change of ['revoke', 'identity', 'order', 'copy', 'metadata'] as const) {
    const db = syntheticPublicDatabase({ change })
    await assert.rejects(loadPublicBinder({ token: 'synthetic-token' }, db.client), change)
  }
})

test('pages all scoped slots and placements beyond 1000 without global inventory', async () => {
  const db = syntheticPublicDatabase({ large: true })
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots.length, 1007)
  assert.ok(db.calls.filter(c => c.table === 'binder_slots').length >= 3)
  assert.ok(db.calls.filter(c => c.table === 'inventory_placements').length >= 3)
})

test('unknown catalog never uses legacy/source/grade JSON as card or matching evidence', async () => {
  const db = syntheticPublicDatabase({ unknown: true })
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots[0].card?.name, 'Unknown card')
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('deep public field allowlist, certificate contamination and canonical artwork', async () => {
  const db = syntheticPublicDatabase()
  db.tables.inventory_items[0].grading = { certificate: 'PRIVATE-certificate', grade: 'PRIVATE-certificate', provider: { kind: 'custom', name: 'https://PRIVATE-cert-link' }, label: { assetIds: ['PRIVATE-label'] } }
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots[0].item?.grading, null)
  assert.equal(result.slots[0].recordedProvider, undefined)
  for (const slot of result.slots) {
    assert.ok(Object.keys(slot).every(k => ['id', 'target', 'item', 'card', 'pokemon', 'recordedProvider', 'wantedCards'].includes(k)))
    if (slot.item) assert.deepEqual(Object.keys(slot.item), ['grading'])
    if (slot.item?.grading) assert.deepEqual(Object.keys(slot.item.grading), ['grade'])
    if (slot.card) assert.ok(Object.keys(slot.card).every(k => ['name', 'image', 'id', 'language', 'pokemonIds'].includes(k)))
    if (slot.card?.image) assert.match(slot.card.image, /^https:\/\/assets\.tcgdex\.net\/en\/synthetic\/synthetic\/\d\/high.webp$/)
  }
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('the share carries only the owner price switch, never price data or price reads', async () => {
  for (const prices of [false, true]) {
    const db = syntheticPublicDatabase({ prices })
    const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
    assert.equal(result.prices, prices)
    assert.ok(!db.calls.some(c => c.table === 'card_prices'))
    assert.ok(!/gbp|amount|price/i.test(JSON.stringify(result.slots)))
  }
})

test('a binder without collection state fails closed', async () => {
  const db = syntheticPublicDatabase()
  db.tables.storage_collection_state = []
  await assert.rejects(loadPublicBinder({ token: 'synthetic-token' }, db.client))
})

test('over 1000 distinct catalog cards and associations use bounded batched reads', async () => {
  const db = syntheticPublicDatabase({ large: true })
  db.tables.tcg_cards = []
  db.tables.tcg_card_dex_ids = []
  for (const [index, item] of db.tables.inventory_items.entries()) {
    const cardId = `synthetic-${String(index).padStart(4, '0')}`
    item.identity = { kind: 'card', cardId }
    db.tables.tcg_cards.push({ id: cardId, name_en: `Synthetic printing ${index}`, image_languages_json: [] })
    db.tables.tcg_card_dex_ids.push({ card_id: cardId, dex_id: 143 })
  }
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots.length, 1007)
  assert.equal(result.slots.at(-1)?.card?.name, 'Synthetic printing 1006')
  assert.ok(db.calls.filter(c => ['tcg_cards', 'tcg_card_dex_ids'].includes(c.table)).length < 100)
})

test('geometry is never guessed', async () => {
  const db = syntheticPublicDatabase()
  db.tables.binders[0].binder_rows = null
  db.tables.binders[0].binder_cols = null
  db.tables.user_settings = []
  await assert.rejects(loadPublicBinder({ token: 'synthetic-token' }, db.client))
})

test('null binder geometry inherits the owner settings like the private binder', async () => {
  const db = syntheticPublicDatabase()
  db.tables.binders[0].binder_rows = null
  db.tables.binders[0].binder_cols = null
  db.tables.user_settings[0].binder_rows = 3
  for (const identity of [{ token: 'synthetic-token' }, { username: 'synthetic-owner', binderSlug: 'mixed' }]) {
    const binder = await loadPublicBinder(identity, db.client)
    assert.deepEqual([binder.rows, binder.cols], [3, 4])
  }
})

test('catalog aliases resolve to the canonical printing without serializing source JSON', async () => {
  const db = syntheticPublicDatabase()
  db.tables.inventory_items[0].identity = { kind: 'card', cardId: 'synthetic-alias' }
  db.tables.tcg_cards[0].external_ids_json = { catalog: { canonicalId: 'synthetic-mon', aliasIds: ['synthetic-alias'] }, source: 'PRIVATE-json' }
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots[0].card?.name, 'Synthetic Snorlax')
  assert.equal(result.slots[0].card?.id, 'synthetic-mon')
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('historical binderless tokens resolve the exact current default without creating or enumerating binders', async () => {
  const db = syntheticPublicDatabase()
  db.tables.binder_shares[0].binder_id = null
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.slots.length, 7)
  assert.ok(db.calls.filter(c => c.table === 'binders').every(c => c.filters.is_default === true))
})

for (const identity of [{ token: 'synthetic-token' }, { username: 'synthetic-owner', binderSlug: 'mixed' }]) {
  test(`public artwork preserves each copy and target language: ${JSON.stringify(identity)}`, async () => {
    const db = syntheticPublicDatabase()
    db.tables.tcg_cards[0].image_languages_json = ['en', 'ja']
    db.tables.inventory_items[0].identity = { kind: 'card', cardId: 'synthetic-mon', language: 'ja' }
    db.tables.inventory_items[1].identity = { kind: 'card', cardId: 'synthetic-mon', language: 'en' }
    db.tables.binder_slots[4].target = { kind: 'card', cardId: 'synthetic-mon', language: 'ja' }
    db.tables.binder_slots[5].target = { kind: 'card', cardId: 'synthetic-mon', language: 'fr' }
    const result = await loadPublicBinder(identity, db.client)
    assert.match(result.slots[0].card!.image!, /\/ja\/synthetic\//)
    assert.match(result.slots[1].card!.image!, /\/en\/synthetic\//)
    assert.match(result.slots[4].card!.image!, /\/ja\/synthetic\//)
    // No French print: the nearest TCGdex language, as every other surface picks (pickCardImageUrl).
    assert.match(result.slots[5].card!.image!, /\/en\/synthetic\//)
  })
}

test('cards without a TCGdex image use the shared fallback source, never an unknown host', async () => {
  const db = syntheticPublicDatabase()
  db.tables.tcg_cards[0].image_languages_json = []
  db.tables.tcg_cards[0].external_ids_json = { pokemon_tcg: { imageLarge: 'https://images.pokemontcg.io/synthetic/1_hires.png' } }
  assert.equal((await loadPublicBinder({ token: 'synthetic-token' }, db.client)).slots[0].card!.image, 'https://images.pokemontcg.io/synthetic/1_hires.png')
  db.tables.tcg_cards[0].external_ids_json = { pokemon_tcg: { imageLarge: 'https://PRIVATE.example/1.png' } }
  assert.equal((await loadPublicBinder({ token: 'synthetic-token' }, db.client)).slots[0].card!.image, undefined)
})

// Synthetic wants. Private fields carry PRIVATE sentinels that must never reach the projection.
const syntheticWant = (cardId: string, extra: Record<string, unknown> = {}) => ({ card_id: cardId, card_name: 'PRIVATE-stored-name', added_at: '2026-01-01T00:00:00.000Z',
  wanted_by: ['00000000-0000-4000-8000-000000000001'], card_image: 'https://PRIVATE-image', notes: 'PRIVATE-notes', cost: 'PRIVATE-cost', source: 'PRIVATE-source', ...extra })

test('native wants keep stored order and repeats, name and artwork only', async () => {
  const db = syntheticPublicDatabase()
  db.tables.binder_slots[6].wanted_cards = [syntheticWant('synthetic-trainer'), syntheticWant('synthetic-mon'), syntheticWant('synthetic-trainer')]
  db.tables.binder_slots[1].wanted_cards = [syntheticWant('uncatalogued', { card_name: 'Synthetic Promo', card_image: 'https://assets.tcgdex.net/en/synthetic/synthetic/9/high.webp' })]
  db.tables.binder_slots[2].wanted_cards = [syntheticWant('uncatalogued', { card_name: 'https://PRIVATE-link' }), { card_name: 'no id' }, 'junk']
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.deepEqual(result.slots[6].wantedCards?.map(w => w.card_name), ['Synthetic Trainer', 'Synthetic Snorlax', 'Synthetic Trainer'])
  assert.match(result.slots[6].wantedCards![0].card_image!, /^https:\/\/assets\.tcgdex\.net\/en\/synthetic\/synthetic\/1\/high.webp$/)
  assert.deepEqual(result.slots[1].wantedCards, [{ card_name: 'Synthetic Promo', card_image: 'https://assets.tcgdex.net/en/synthetic/synthetic/9/high.webp' }])
  assert.deepEqual(result.slots[0].card, { name: 'Synthetic Snorlax', image: 'https://assets.tcgdex.net/en/synthetic/synthetic/0/high.webp', id: 'synthetic-mon', language: 'en', pokemonIds: [143] })
  assert.equal(result.slots[2].wantedCards, undefined)
  // The empty-target slot without stored wants never gains one.
  assert.equal(result.slots[5].wantedCards, undefined)
  for (const slot of result.slots) for (const want of slot.wantedCards ?? []) assert.ok(Object.keys(want).every(k => ['card_name', 'card_image', 'card_id', 'card_language', 'pokemonIds'].includes(k)))
  assert.deepEqual(result.slots[6].wantedCards?.map(w => w.card_id), ['synthetic-trainer', 'synthetic-mon', 'synthetic-trainer'])
  assert.ok(!('card_id' in result.slots[1].wantedCards![0]))
  const json = JSON.stringify(result)
  for (const sentinel of ['PRIVATE', 'wanted_by', '00000000-0000', 'added_at', 'notes', 'cost', 'source']) assert.ok(!json.includes(sentinel), sentinel)
})

test('read-only BinderApp input is built from the public projection alone', async () => {
  const { publicBinderDisplayInput } = await import('../lib/public-binder-display')
  const { buildSlotDisplay } = await import('../lib/binder-display-model')
  const db = syntheticPublicDatabase()
  db.tables.binder_slots[6].wanted_cards = [syntheticWant('synthetic-trainer'), syntheticWant('synthetic-energy')]
  const input = publicBinderDisplayInput(await loadPublicBinder({ token: 'synthetic-token' }, db.client))
  const display = buildSlotDisplay(input.binder, input.inventory, input.resolveCard!)
  const json = JSON.stringify(input)
  for (const sentinel of ['PRIVATE', 'binder-allowed', 'wanted_by', '00000000-0000']) assert.ok(!json.includes(sentinel), sentinel)
  assert.deepEqual(display.map(s => s.card?.name ?? s.pokemon?.name ?? null), ['Synthetic Snorlax', 'Synthetic Snorlax', 'Synthetic Trainer', 'Synthetic Energy', null, null, 'snorlax'])
  assert.deepEqual(display[6].wantedCards.map(w => [w.card_id, w.card_name]), [['synthetic-trainer', 'Synthetic Trainer'], ['synthetic-energy', 'Synthetic Energy']])
  assert.equal(display[0].item?.grading?.grade, '9')
})

test('Prices view looks up each owned pocket by its public printing, never targets or wants', async () => {
  const { publicBinderDisplayInput } = await import('../lib/public-binder-display')
  const { buildSlotDisplay, displaySlotPriceLookup } = await import('../lib/binder-display-model')
  const db = syntheticPublicDatabase({ prices: true })
  db.tables.inventory_items[1].identity = { kind: 'card', cardId: 'synthetic-mon', language: 'ja' }
  db.tables.binder_slots[5].target = { kind: 'card', cardId: 'synthetic-mon' }
  db.tables.binder_slots[6].wanted_cards = [syntheticWant('synthetic-trainer')]
  const input = publicBinderDisplayInput(await loadPublicBinder({ token: 'synthetic-token' }, db.client))
  const lookups = buildSlotDisplay(input.binder, input.inventory, input.resolveCard!).map(displaySlotPriceLookup)
  assert.deepEqual(lookups, [
    { cardId: 'synthetic-mon', language: 'en' }, { cardId: 'synthetic-mon', language: 'ja' }, { cardId: 'synthetic-trainer', language: 'en' }, { cardId: 'synthetic-energy', language: 'en' },
    null, null, null,
  ])
})

test('public read index: truthful species search, distinct wants, exact pockets and jumps', async () => {
  const { publicBinderDisplayInput, publicReadIndex } = await import('../lib/public-binder-display')
  const { buildSlotDisplay } = await import('../lib/binder-display-model')
  const db = syntheticPublicDatabase()
  // 2x3 pages. Slot 6 (page 2, A1) is an unfilled Snorlax target with two wants; slot 0 owns a Snorlax printing with one want.
  db.tables.binder_slots[6].wanted_cards = [syntheticWant('synthetic-trainer'), syntheticWant('synthetic-trainer')]
  db.tables.binder_slots[0].wanted_cards = [syntheticWant('synthetic-mon')]
  const binder = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  const input = publicBinderDisplayInput(binder)
  const index = publicReadIndex(binder, input)
  const display = buildSlotDisplay(input.binder, input.inventory, input.resolveCard!)
  // Snorlax: first needed/wanted pocket is slot 0 (it carries a want), never a dex-order guess.
  assert.deepEqual(index.speciesLocation(143), { slotId: 'public-0', slotIndex: 0, page: 1, label: 'A1' })
  assert.equal(index.searchMeta(143).locationLabel, 'Page 1 • A1')
  assert.equal(index.searchMeta(143).slotState, 'wanted')
  // A species the binder doesn't hold has no destination and no Needed/Missing state.
  assert.equal(index.speciesLocation(1), null)
  assert.equal(index.searchMeta(1).slotState, undefined)
  assert.equal(index.searchMeta(1).pageNumber, null)
  assert.deepEqual(index.pageSpecies(2).map(p => p.id), [143])
  // Each stored want is its own entry and opens its own pocket, repeats included.
  assert.deepEqual(index.wantEntries.map(w => [w.card.card_id, index.wantLocation(w.card)?.slotId]), [['synthetic-mon', 'public-0'], ['synthetic-trainer', 'public-6'], ['synthetic-trainer', 'public-6']])
  assert.equal(index.wantEntries[1].card, display[6].wantedCards[0])
  assert.notEqual(index.wantEntries[1].card, index.wantEntries[2].card)
  // Copies stay distinct rows; species map is only a lookup for species views.
  assert.equal(index.species.rows.filter(r => r.status === 'collected').length, 4)
  assert.equal(index.species.bySpecies.get(143)?.status, 'collected')
  // Wants without their own species links belong to the pocket's species (the two Trainer wants sit in a Snorlax pocket).
  assert.equal(index.species.bySpecies.get(143)?.wanted_cards.length, 3)
  // Needed jump goes pocket by pocket in binder order and wraps.
  assert.equal(index.jump('needed', -1, 'next')?.slotId, 'public-6')
  assert.equal(index.jump('needed', 6, 'next')?.slotId, 'public-6')
  assert.equal(index.jump('wanted', 0, 'next')?.slotId, 'public-6')
  assert.equal(index.jump('favorite', 0, 'next'), null)
  // Quick state checks the exact printing.
  const mon = { id: 'synthetic-mon', language: 'en' } as never
  assert.deepEqual([index.quickState(mon, 143).owned, index.quickState(mon, 143).wanted], [true, true])
  assert.deepEqual([index.quickState({ id: 'synthetic-energy', language: 'ja' } as never, 143).owned], [false])
  assert.ok(!JSON.stringify([...index.species.bySpecies.values(), index.species.rows]).includes('PRIVATE'))
})


test('public species ownership comes from copies and survives earlier wants', async () => {
  const { publicBinderDisplayInput, publicReadIndex } = await import('../lib/public-binder-display')
  const binder = await loadPublicBinder({ token: 'synthetic-token' }, syntheticPublicDatabase().client)
  const owned = { ...binder.slots[0], id: 'public-owned', target: { kind: 'pokemon' as const, pokemonId: 1 }, card: { ...binder.slots[0].card!, pokemonIds: [143] }, pokemon: null, wantedCards: [] }
  const wanted = { ...owned, id: 'public-wanted', item: null, card: null, wantedCards: [{ card_name: 'Synthetic Snorlax', card_id: 'synthetic-mon', pokemonIds: [143] }] }
  binder.slots = [wanted, owned]
  const index = publicReadIndex(binder, publicBinderDisplayInput(binder))
  assert.equal(index.species.bySpecies.get(143)?.status, 'collected')
  assert.equal(index.species.bySpecies.get(143)?.wanted_cards.length, 1)
  assert.notEqual(index.species.bySpecies.get(1)?.status, 'collected', 'a mismatched target does not create ownership')
  assert.equal(index.species.rows.find(row => row.status === 'collected')?.pokemon_id, 143)
})
