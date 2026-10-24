import test from "node:test"
import assert from "node:assert/strict"
import { extractCardTextSignals } from "../lib/card-scan-text"
import {
  decideScanOutcome,
  findPokemonNameInText,
  isScanReadComplete,
  pickCollectorNumber,
  readScannedCard,
} from "../lib/card-scan-identify"
import type { SearchCardResult } from "../lib/pokemon-card-browse"

const card = (id: string, name: string, localId: string, setName: string, total: number, dexIds: number[]): SearchCardResult => ({
  id,
  name,
  localId,
  dexIds,
  set: { id: id.split("-")[0], name: setName, officialCardCount: total },
})

const CHARIZARD_151 = card("sv03.5-006", "Charizard ex", "006", "151", 165, [6])
const CHARIZARD_OBF = card("sv03-006", "Charizard ex", "006", "Obsidian Flames", 197, [6])
const CHARIZARD_BASE = card("base1-4", "Charizard", "4", "Base Set", 102, [6])
const BULBASAUR_151 = card("sv03.5-001", "Bulbasaur", "001", "151", 165, [1])
const lookup = (id: number) => ({ 6: { id: 6, name: "Charizard" }, 1: { id: 1, name: "Bulbasaur" } } as Record<number, { id: number; name: string }>)[id] ?? null

test("finds the Pokémon on the name line, ignoring 'Evolves from'", () => {
  assert.deepEqual(findPokemonNameInText("STAGE 2 Evolves from Charmeleon\nCharizard ex HP 330"), { id: 6, name: "Charizard" })
  assert.deepEqual(findPokemonNameInText("Basic  Mr. Mime  HP 70"), { id: 122, name: "Mr. Mime" })
  assert.equal(findPokemonNameInText("Trainer Supporter Professor's Research"), null)
})

test("tolerates one misread letter in a long name, but not in short ones", () => {
  assert.equal(findPokemonNameInText("Charizavd ex 330")?.name, "Charizard")
  assert.equal(findPokemonNameInText("Mow 50")?.name, undefined)
})

test("reads the collector number, preferring the full number with the set total", () => {
  assert.deepEqual(pickCollectorNumber(extractCardTextSignals("illus. 5ban Graphics 006/165")), { number: "6", total: "165" })
  assert.deepEqual(pickCollectorNumber(extractCardTextSignals("SWSH050")), { number: "swsh50", total: null })
  assert.equal(pickCollectorNumber(extractCardTextSignals("Charizard ex HP 330")), null)
})

test("builds the search from what was read", () => {
  assert.equal(readScannedCard(extractCardTextSignals("Charizard ex HP 330\n006/165")).query, "Charizard 6/165")
  assert.equal(readScannedCard(extractCardTextSignals("Charizard ex HP 330")).query, "Charizard")
  assert.equal(readScannedCard(extractCardTextSignals("006/165")).query, "6/165")
  assert.equal(readScannedCard(null).query, "")
  assert.equal(isScanReadComplete(extractCardTextSignals("Charizard ex\n006/165")), true)
  assert.equal(isScanReadComplete(extractCardTextSignals("Charizard ex")), false)
})

test("opens the card when name, number and set total agree", () => {
  const read = readScannedCard(extractCardTextSignals("Charizard ex HP 330\n006/165"))
  const outcome = decideScanOutcome([CHARIZARD_OBF, CHARIZARD_BASE, CHARIZARD_151, BULBASAUR_151], read, lookup)
  assert.equal(outcome.kind, "match")
  assert.equal(outcome.kind === "match" && outcome.card.id, "sv03.5-006")
  assert.deepEqual(outcome.kind === "match" && outcome.pokemon, { id: 6, name: "Charizard" })
})

test("asks to choose when the set total can't separate two printings", () => {
  const read = readScannedCard(extractCardTextSignals("Charizard ex\nSV 006"))
  assert.equal(read.number, null)
  assert.deepEqual(decideScanOutcome([CHARIZARD_OBF, CHARIZARD_151], read, lookup), { kind: "choose", query: "Charizard" })
  const noTotal = { ...readScannedCard(extractCardTextSignals("Charizard ex\n006/165")), number: { number: "6", total: null } }
  assert.equal(decideScanOutcome([CHARIZARD_OBF, CHARIZARD_151], noTotal, lookup).kind, "choose")
})

test("a single name-and-number match opens even without the total", () => {
  const read = { ...readScannedCard(extractCardTextSignals("Charizard\n4/102")), number: { number: "4", total: "120" } }
  const outcome = decideScanOutcome([CHARIZARD_BASE, CHARIZARD_151], read, lookup)
  assert.equal(outcome.kind === "match" && outcome.card.id, "base1-4")
})

test("nothing readable, or nothing found, falls back to typing", () => {
  assert.deepEqual(decideScanOutcome([CHARIZARD_151], readScannedCard(extractCardTextSignals("HP 330 Weakness")), lookup), { kind: "unread", query: "" })
  assert.deepEqual(decideScanOutcome([], readScannedCard(extractCardTextSignals("Charizard ex\n006/165")), lookup), { kind: "choose", query: "Charizard 6/165" })
  assert.deepEqual(decideScanOutcome([], readScannedCard(extractCardTextSignals("006/165")), lookup), { kind: "unread", query: "6/165" })
})
