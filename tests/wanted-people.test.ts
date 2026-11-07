import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWantedCard } from '../lib/collection/normalize'
import { collectionFingerprint, resolveConflict } from '../lib/collection/sync'
import { groupGlobalWanted, mergeWantedPeople, wantedPeopleLabel, validateWantedPeople } from '../lib/wanted-people'
import type { WantedCard, CollectedPokemon } from '../lib/domain/cards'

// Synthetic people, cards and binders only.
const me = '00000000-0000-4000-8000-000000000001'
const partner = '00000000-0000-4000-8000-000000000002'
const former = '00000000-0000-4000-8000-000000000003'
const card: WantedCard = { card_id: 'fixture', card_name: 'Fixture', card_language: 'en', card_finish: 'normal', added_at: '2026-11-07' }
const slot = (wanted: WantedCard): CollectedPokemon => ({ id: 'slot', pokemon_id: 1, pokemon_name: 'Fixture', wanted_cards: [wanted], status: 'wishlisted', collected_at: '2026-11-07' })

test('wanted attribution preserves legacy absence and normalizes stable IDs', () => {
 assert.equal(normalizeWantedCard(card)?.wanted_by, undefined)
 assert.deepEqual(normalizeWantedCard({ ...card, wanted_by: [partner, me, me, 'invalid'] })?.wanted_by, [me, partner])
 assert.deepEqual(normalizeWantedCard({ ...card, wanted_by: [] })?.wanted_by, [])
})

test('independent membership edits merge and omitted legacy attribution never clears a newer assignment', () => {
 assert.deepEqual(mergeWantedPeople([], [me], [partner]), [me, partner])
 assert.deepEqual(mergeWantedPeople([me, partner], [me], [partner]), [])
 assert.deepEqual(mergeWantedPeople([me], undefined, [partner]), [partner])
 const base = slot(card), local = slot({ ...card, wanted_by: [me] }), remote = slot({ ...card, wanted_by: [partner] })
 assert.notEqual(collectionFingerprint(local), collectionFingerprint(base))
 const result = resolveConflict({ type: 'upsert', pokemonId: 1, base, item: local }, remote)
 assert.equal(result.action, 'write')
 if (result.action === 'write') assert.deepEqual(result.item.wanted_cards[0].wanted_by, [me, partner])
 const legacy = resolveConflict({ type: 'upsert', pokemonId: 1, base, item: base }, remote)
 assert.equal(legacy.action, 'drop')
})

test('global results group printing and retain every binder location and person', () => {
 const entries = [{ pokemonId: 1, pokemonName: 'Fixture', card: { ...card, wanted_by: [me] }, binderId: 'binder-1', binderName: 'First' }, { pokemonId: 1, pokemonName: 'Fixture', card: { ...card, wanted_by: [partner] }, binderId: 'binder-2', binderName: 'Second' }]
 const grouped = groupGlobalWanted(entries)
 assert.equal(grouped.length, 1)
 assert.deepEqual(grouped[0].card.wanted_by, [me, partner])
 assert.equal(grouped[0].locations?.length, 2)
 assert.deepEqual(grouped[0].locations?.map(location => location.binderName), ['First', 'Second'])
 assert.equal(groupGlobalWanted([...entries, { ...entries[1], card: { ...card, card_finish: 'holo' } }]).length, 2)
 assert.equal(entries[0].card.wanted_by.length, 1)
})

test('labels use only current membership and never assign a future partner an old want', () => {
 assert.equal(wantedPeopleLabel(undefined, me, partner, 'Alex'), 'Unassigned')
 assert.equal(wantedPeopleLabel([me, partner], me, partner, 'Alex'), 'You, Alex')
 assert.equal(wantedPeopleLabel([former], me, partner, 'Alex'), 'Another collector')
})

test('server attribution validation rejects outsiders and preserves omitted or unchanged old assignments', () => {
 assert.deepEqual(validateWantedPeople([{ ...card }], [{ ...card, wanted_by: [partner] }], [me, partner])[0].wanted_by, [partner])
 assert.deepEqual(validateWantedPeople([{ ...card, wanted_by: [former] }], [{ ...card, wanted_by: [former] }], [me, partner])[0].wanted_by, [former])
 assert.throws(() => validateWantedPeople([{ ...card, wanted_by: [former] }], [], [me, partner]), /assignment/)
 assert.throws(() => validateWantedPeople([{ ...card, wanted_by: ['invalid'] }], [], [me]), /assignment/)
 assert.deepEqual(validateWantedPeople([{ ...card, wanted_by: [] }], [{ ...card, wanted_by: [me] }], [me])[0].wanted_by, [])
})
