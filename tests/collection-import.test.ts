import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseImportFile, mapImportRows, buildImportPlan, buildImportReport, applyImportPlan } from '../lib/collection-import'
import { buildCollectionCsv } from '../lib/collection-export'
import { normalizeCollectionItem } from '../lib/collection/normalize'

const defaults = { language: 'en', finish: 'normal', list: 'owned' } as const
const card = (id = 'base1-44', wants: string[] = []) => normalizeCollectionItem({ pokemon_id: 1, pokemon_name: 'bulbasaur', card_id: id, card_name: 'Bulbasaur', card_set: 'Base Set', status: 'collected', wanted_cards: wants.map(card_id => ({ card_id, card_name: 'Synthetic wanted', added_at: '2026-01-01' })) })
function imported(items = [card()]) {
  const document = parseImportFile(buildCollectionCsv(items, {}))
  return mapImportRows(document, document.mapping, defaults)
}

test('CSV parser preserves quoted commas, escaped quotes, BOM and multiline cells', () => {
  const doc = parseImportFile('\ufeffName,Set,Note\r\n"Bulbasaur, special","Base Set","line 1\nline ""2"""\r\n')
  assert.deepEqual(doc.headers, ['Name', 'Set', 'Note'])
  assert.deepEqual(doc.records, [['Bulbasaur, special', 'Base Set', 'line 1\nline "2"']])
  assert.throws(() => parseImportFile('Name,Set\n"unclosed,Base'), /quote/i)
  assert.throws(() => parseImportFile('Name,Name\nA,B'), /header/i)
  assert.throws(() => parseImportFile('Name\n' + 'A\n'.repeat(5001)), /5,000/)
})

test('Holo Folder CSV round trip preserves owned and wanted printings without importing prices', () => {
  const rows = imported([card('base1-44', ['base2-67'])])
  assert.equal(rows.length, 2)
  const plan = buildImportPlan(rows, [])
  assert.equal(plan.operations.length, 1)
  assert.equal(plan.operations[0].next.card_id, 'base1-44')
  assert.equal(plan.operations[0].next.wanted_cards[0].card_id, 'base2-67')
  assert.equal(plan.delta, 2)
  assert.equal('market_gbp' in plan.operations[0].next, false)
})

test('backup import is collection only, strips identities and rejects invalid enum values', () => {
  const doc = parseImportFile(JSON.stringify({ format: 'holofolder-binder-backup', version: 1, settings: { darkMode: false }, collection: [card('base1-44', ['base2-67'])] }))
  const rows = mapImportRows(doc, doc.mapping, defaults)
  assert.equal(rows.length, 2)
  assert.equal(rows[1].item?.wanted_cards[0].wanted_by, undefined)
  const invalid = parseImportFile(JSON.stringify({ format: 'holofolder-binder-backup', version: 1, collection: [{ ...card(), card_language: 'xx' }] }))
  assert.match(mapImportRows(invalid, invalid.mapping, defaults)[0].problem ?? '', /language/i)
  assert.throws(() => parseImportFile('{'), /JSON/i)
  assert.throws(() => parseImportFile(JSON.stringify({ format: 'holofolder-binder-backup', version: 2, collection: [] })), /version/i)
})

test('generic CSV maps identity columns and exposes unsupported quantities and metadata', () => {
  const doc = parseImportFile('Title,Expansion,Number,Qty,Grade\nBulbasaur,Base Set,0044,2,\nBulbasaur,Base Set,44,1,PSA 10')
  const rows = mapImportRows(doc, { cardName: 0, set: 1, number: 2, quantity: 3, grade: 4 }, defaults)
  assert.equal(rows[0].lookup.number, '0044')
  assert.match(rows[0].problem ?? '', /quantity/i)
  assert.match(rows[1].problem ?? '', /grad/i)
  const language = parseImportFile('Title,Lang\nBulbasaur,xx')
  assert.match(mapImportRows(language, { cardName: 0, language: 1 }, defaults)[0].problem ?? '', /language/i)
})

test('merge preserves occupied selections, appends wants and makes repeat imports no-ops', () => {
  const existing = card('base2-67', ['base3-1'])
  const plan = buildImportPlan(imported([card('base1-44', ['base4-1'])]), [existing])
  assert.equal(plan.operations[0].next.card_id, 'base2-67')
  assert.deepEqual(plan.operations[0].next.wanted_cards.map(c => c.card_id), ['base3-1', 'base4-1'])
  assert.equal(plan.rows[0].outcome, 'conflict')
  assert.equal(plan.delta, 1)
  assert.equal(buildImportPlan(imported([card('base1-44', ['base4-1'])]), [plan.operations[0].next]).operations.length, 0)
  assert.equal(existing.wanted_cards.length, 1)
})

test('multiple owned printings require a selection, while exact duplicates do not', () => {
  const rows = [...imported(), ...imported([card('base2-67')]).map(row => ({ ...row, row: row.row + 10 }))]
  assert.equal(buildImportPlan(rows, []).operations.length, 0)
  assert.equal(buildImportPlan(rows, []).rows[0].outcome, 'choice')
  const selected = buildImportPlan(rows, [], new Set([rows[1].row]))
  assert.equal(selected.operations[0].next.card_id, 'base2-67')
  assert.equal(buildImportPlan(rows, [], new Set(rows.map(row => row.row))).operations.length, 0)
  assert.equal(buildImportPlan(imported([card(), card()]), []).operations.length, 1)
})

test('pending slots are not changed and reports retain original cells with formula protection', () => {
  const rows = imported()
  const plan = buildImportPlan(rows, [], undefined, new Set([1]))
  assert.equal(plan.operations.length, 0)
  assert.match(plan.rows[0].reason, /unsynced/i)
  const report = buildImportReport([{ ...plan.rows[0], reason: '=HYPERLINK("bad")' }])
  assert.match(report, /'=HYPERLINK/)
  assert.match(report, /base1-44/)
})

test('a selected printing does not import other candidates for the same slot', () => {
  const rows = [...imported(), ...imported([card('base2-67')]).map(row => ({ ...row, row: row.row + 10 }))]
  assert.equal(buildImportPlan(rows, [], new Set([rows[0].row])).operations[0].next.card_id, 'base1-44')
  assert.equal(buildImportPlan(rows, [card()], undefined).operations.length, 0)
})

test('application stops after a hard failure and reports completed and unapplied rows honestly', async () => {
  const entries = [card(), { ...card('synthetic-4'), pokemon_id: 4 }, { ...card('synthetic-7'), pokemon_id: 7 }]
  const plan = buildImportPlan(imported(entries), [])
  let calls = 0
  const result = await applyImportPlan(plan, async () => ++calls === 1 ? { queued: true } : { error: 'Allowance exhausted' }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.deepEqual([result.saved, result.queued, result.failed], [0, 1, 1])
  assert.deepEqual(result.rows.map(row => row.outcome), ['queued', 'failed', 'not applied'])
})

test('cancellation retains an in-flight success but never submits the next slot', async () => {
  const plan = buildImportPlan(imported([card(), { ...card('synthetic-4'), pokemon_id: 4 }]), [])
  const controller = new AbortController()
  let calls = 0
  const result = await applyImportPlan(plan, async () => { calls++; controller.abort(); return { queued: false } }, controller.signal)
  assert.equal(calls, 1)
  assert.equal(result.saved, 1)
  assert.equal(result.cancelled, true)
  assert.deepEqual(result.rows.map(row => row.outcome), ['saved', 'not applied'])
})
