import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeWantedCard } from '../lib/collection/normalize'
import { groupGlobalWanted, wantedPeopleLabel } from '../lib/wanted-people'
import type { WantedCard } from '../lib/domain/cards'

// Synthetic people, cards and binders only.
const me = '00000000-0000-4000-8000-000000000001'
const partner = '00000000-0000-4000-8000-000000000002'
const former = '00000000-0000-4000-8000-000000000003'
const card: WantedCard = { card_id: 'fixture', card_name: 'Fixture', card_language: 'en', card_finish: 'normal', added_at: '2026-11-07' }

test('wanted attribution preserves legacy absence and normalizes stable IDs', () => {
 assert.equal(normalizeWantedCard(card)?.wanted_by, undefined)
 assert.deepEqual(normalizeWantedCard({ ...card, wanted_by: [partner, me, me, 'invalid'] })?.wanted_by, [me, partner])
 assert.deepEqual(normalizeWantedCard({ ...card, wanted_by: [] })?.wanted_by, [])
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

