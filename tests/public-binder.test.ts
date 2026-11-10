import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadPublicBinder } from '../lib/server/public-binder'
import { syntheticPublicDatabase } from './fixtures/public-binder'

for (const identity of [{ token: 'synthetic-token' }, { username: 'synthetic-owner', binderSlug: 'mixed' }]) {
  test(`public loader authorizes and preserves exact current slots: ${JSON.stringify(identity)}`, async () => {
    const db = syntheticPublicDatabase()
    const result = await loadPublicBinder(identity, db.client)
    assert.equal(result.kind, 'native')
    assert.equal(result.rows, 2)
    assert.equal(result.cols, 3)
    assert.deepEqual(result.slots.map(s => s.card?.name ?? s.pokemon?.name ?? null), ['Synthetic Snorlax', 'Synthetic Snorlax', 'Synthetic Trainer', 'Synthetic Energy', null, null, 'snorlax'])
    assert.deepEqual(result.completion, { targetCount: 3, completedTargetCount: 2 })
    const json = JSON.stringify(result)
    for (const sentinel of ['PRIVATE', 'certificate', 'assetIds', 'ownerUserId', 'inventoryItemId', 'wanted_by', 'source', 'acquired', 'marketGBP', 'cost']) assert.ok(!json.includes(sentinel), sentinel)
    assert.equal(result.prices, false)
    assert.deepEqual(Object.keys(result).sort(), ['appearance', 'cols', 'completion', 'kind', 'name', 'prices', 'rows', 'slots'].sort())
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
  assert.deepEqual(result.completion, { targetCount: 3, completedTargetCount: 0 })
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
    if (slot.card) assert.ok(Object.keys(slot.card).every(k => ['name', 'image', 'id', 'language'].includes(k)))
    if (slot.card?.image) assert.match(slot.card.image, /^https:\/\/assets\.tcgdex\.net\/en\/synthetic\/synthetic\/\d\/high.webp$/)
  }
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('exact current card targets use canonical matcher and language/finish constraints', async () => {
  const db = syntheticPublicDatabase()
  db.tables.binder_slots[0].target = { kind: 'card', cardId: 'synthetic-mon', language: 'ja' }
  db.tables.binder_slots[1].target = { kind: 'card', cardId: 'synthetic-mon', finish: 'holo' }
  db.tables.binder_slots[2].target = { kind: 'card', cardId: 'synthetic-trainer' }
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.deepEqual(result.completion, { targetCount: 4, completedTargetCount: 1 })
})

test('legacy adapter keeps National Dex layout without consulting global or unassigned items', async () => {
  const db = syntheticPublicDatabase({ legacy: true })
  db.tables.pokemon_collection.push({ user_id: 'PRIVATE-owner', binder_id: 'binder-allowed', pokemon_id: 143, status: 'collected', card_id: 'synthetic-mon', card_language: 'en' })
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.kind, 'legacy')
  assert.equal(result.slots.length, 1025)
  assert.equal(result.slots[142].card?.name, 'Synthetic Snorlax')
  assert.ok(!db.calls.some(c => ['inventory_items', 'inventory_placements', 'binder_slots'].includes(c.table)))
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('owner price visibility controls data reads and serialization', async () => {
  for (const prices of [false, true]) {
    const db = syntheticPublicDatabase({ prices })
    const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
    assert.equal(result.slots[0].marketGBP, prices ? 12.34 : undefined)
    assert.equal(result.prices, prices)
    assert.equal(db.calls.some(c => c.table === 'card_prices'), prices)
    assert.ok(!JSON.stringify(result).includes('PRIVATE-cost'))
  }
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

test('native geometry is never guessed, while legacy retains its default layout contract', async () => {
  for (const legacy of [false, true]) {
    const db = syntheticPublicDatabase({ legacy })
    db.tables.binders[0].binder_rows = null
    db.tables.binders[0].binder_cols = null
    db.tables.user_settings = []
    if (legacy) assert.equal((await loadPublicBinder({ token: 'synthetic-token' }, db.client)).rows, 4)
    else await assert.rejects(loadPublicBinder({ token: 'synthetic-token' }, db.client))
  }
})

test('null binder geometry inherits the owner settings like the private binder', async () => {
  for (const legacy of [false, true]) {
    const db = syntheticPublicDatabase({ legacy })
    db.tables.binders[0].binder_rows = null
    db.tables.binders[0].binder_cols = null
    db.tables.user_settings[0].binder_rows = 3
    for (const identity of [{ token: 'synthetic-token' }, { username: 'synthetic-owner', binderSlug: 'mixed' }]) {
      const binder = await loadPublicBinder(identity, db.client)
      assert.deepEqual([binder.rows, binder.cols], [3, 4])
    }
  }
})

test('catalog aliases supply actual matching evidence without serializing source JSON', async () => {
  const db = syntheticPublicDatabase()
  db.tables.inventory_items[0].identity = { kind: 'card', cardId: 'synthetic-alias' }
  db.tables.tcg_cards[0].external_ids_json = { catalog: { canonicalId: 'synthetic-mon', aliasIds: ['synthetic-alias'] }, source: 'PRIVATE-json' }
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.equal(result.completion.completedTargetCount, 2)
  assert.equal(result.slots[0].card?.name, 'Synthetic Snorlax')
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
    assert.equal(result.slots[5].card?.image, undefined)
    assert.deepEqual(result.completion, { targetCount: 5, completedTargetCount: 2 })
  })
  test(`legacy public artwork preserves the recorded language: ${JSON.stringify(identity)}`, async () => {
    const db = syntheticPublicDatabase({ legacy: true })
    db.tables.tcg_cards[0].image_languages_json = ['en', 'ja']
    db.tables.pokemon_collection.push({ user_id: 'PRIVATE-owner', binder_id: 'binder-allowed', pokemon_id: 143, status: 'collected', card_id: 'synthetic-mon', card_language: 'ja' })
    const result = await loadPublicBinder(identity, db.client)
    assert.match(result.slots[142].card!.image!, /\/ja\/synthetic\//)
    db.tables.tcg_cards[0].image_languages_json = ['en']
    const unavailable = await loadPublicBinder(identity, db.client)
    assert.equal(unavailable.slots[142].card?.image, undefined)
  })
}

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
  assert.deepEqual(result.slots[0].card, { name: 'Synthetic Snorlax', image: 'https://assets.tcgdex.net/en/synthetic/synthetic/0/high.webp', id: 'synthetic-mon', language: 'en' })
  assert.equal(result.slots[2].wantedCards, undefined)
  // The empty-target slot without stored wants never gains one.
  assert.equal(result.slots[5].wantedCards, undefined)
  for (const slot of result.slots) for (const want of slot.wantedCards ?? []) assert.ok(Object.keys(want).every(k => ['card_name', 'card_image', 'card_id', 'card_language'].includes(k)))
  assert.deepEqual(result.slots[6].wantedCards?.map(w => w.card_id), ['synthetic-trainer', 'synthetic-mon', 'synthetic-trainer'])
  assert.ok(!('card_id' in result.slots[1].wantedCards![0]))
  const json = JSON.stringify(result)
  for (const sentinel of ['PRIVATE', 'wanted_by', '00000000-0000', 'added_at', 'notes', 'cost', 'source']) assert.ok(!json.includes(sentinel), sentinel)
  assert.deepEqual(result.completion, { targetCount: 3, completedTargetCount: 2 })
})

test('legacy wants, including a pre-016 wishlisted printing, are projected without private fields', async () => {
  const db = syntheticPublicDatabase({ legacy: true })
  db.tables.pokemon_collection.push(
    { user_id: 'PRIVATE-owner', binder_id: 'binder-allowed', pokemon_id: 143, status: 'collected', card_id: 'synthetic-mon', card_language: 'en', wanted_cards: [syntheticWant('synthetic-trainer'), syntheticWant('synthetic-energy')] },
    { user_id: 'PRIVATE-owner', binder_id: 'binder-allowed', pokemon_id: 25, status: 'wishlisted', card_id: 'synthetic-mon', card_language: 'en', wanted_cards: [] },
  )
  const result = await loadPublicBinder({ token: 'synthetic-token' }, db.client)
  assert.deepEqual(result.slots[142].wantedCards?.map(w => w.card_name), ['Synthetic Trainer', 'Synthetic Energy'])
  assert.ok(result.slots[142].item)
  assert.deepEqual(result.slots[24].wantedCards?.map(w => w.card_name), ['Synthetic Snorlax'])
  assert.equal(result.slots[24].item, null)
  assert.equal(result.slots[0].wantedCards, undefined)
  assert.ok(!JSON.stringify(result).includes('PRIVATE'))
})

test('read-only BinderApp input is built from the public projection alone', async () => {
  const { publicBinderDisplayInput } = await import('../lib/public-binder-display')
  const { buildSlotDisplay } = await import('../lib/binder-display-model')
  for (const legacy of [false, true]) {
    const db = syntheticPublicDatabase({ legacy })
    db.tables.binder_slots[6].wanted_cards = [syntheticWant('synthetic-trainer'), syntheticWant('synthetic-energy')]
    if (legacy) db.tables.pokemon_collection.push({ user_id: 'PRIVATE-owner', binder_id: 'binder-allowed', pokemon_id: 143, status: 'collected', card_id: 'synthetic-mon', card_language: 'en', wanted_cards: [syntheticWant('synthetic-trainer')] })
    const input = publicBinderDisplayInput(await loadPublicBinder({ token: 'synthetic-token' }, db.client))
    const display = buildSlotDisplay(input.binder, input.inventory, input.resolveCard!)
    const json = JSON.stringify(input)
    for (const sentinel of ['PRIVATE', 'binder-allowed', 'wanted_by', '00000000-0000']) assert.ok(!json.includes(sentinel), sentinel)
    if (legacy) {
      assert.equal(display.length, 1025)
      assert.equal(display[142].card?.name, 'Synthetic Snorlax')
      assert.deepEqual(display[142].wantedCards.map(w => w.card_name), ['Synthetic Trainer'])
    } else {
      assert.deepEqual(display.map(s => s.card?.name ?? s.pokemon?.name ?? null), ['Synthetic Snorlax', 'Synthetic Snorlax', 'Synthetic Trainer', 'Synthetic Energy', null, null, 'snorlax'])
      assert.deepEqual(display[6].wantedCards.map(w => [w.card_id, w.card_name]), [['synthetic-trainer', 'Synthetic Trainer'], ['synthetic-energy', 'Synthetic Energy']])
      assert.equal(display[0].item?.grading?.grade, '9')
    }
  }
})
