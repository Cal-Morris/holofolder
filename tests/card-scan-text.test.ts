import test from "node:test"
import assert from "node:assert/strict"
import {
  applyCardTextSignalBoost,
  extractCardTextSignals,
  mergeCardTextSignals,
  scoreCardTextSignals,
} from "../lib/card-scan-text"

const baseCards = [
  { id: "a", name: "Pikachu", localId: "025", set: { id: "sv1", name: "Scarlet & Violet" } },
  { id: "b", name: "Pikachu", localId: "025/102", set: { id: "base1", name: "Base Set" } },
  { id: "c", name: "Raichu", localId: "026", set: { id: "base1", name: "Base Set" } },
]

test("extractCardTextSignals parses collector numbers and useful words from noisy OCR", () => {
  const signals = extractCardTextSignals("Pikachu HP 60\\n025/102 ● Base Set\\nIllus. Mitsuhiro Arita")

  assert.deepEqual(signals.collectorNumbers, ["25/102", "25", "102"])
  assert.equal(signals.words.has("pikachu"), true)
  assert.equal(signals.words.has("base"), true)
})

test("scoreCardTextSignals strongly rewards collector number and set matches", () => {
  const signals = extractCardTextSignals("025/102 Base Set")

  const baseScore = scoreCardTextSignals(signals, baseCards[1])
  const modernScore = scoreCardTextSignals(signals, baseCards[0])

  assert.ok(baseScore > modernScore)
  assert.ok(baseScore > 0.75)
})

test("applyCardTextSignalBoost can move exact text matches above similar art matches", () => {
  const signals = extractCardTextSignals("025/102 Base Set")
  const boosted = applyCardTextSignalBoost(
    [
      { card: baseCards[0], similarity: 0.86 },
      { card: baseCards[1], similarity: 0.78 },
    ],
    signals,
  )

  assert.equal(boosted[0].card.id, "b")
  assert.ok(boosted[0].similarity > 0.9)
})

test("mergeCardTextSignals combines useful evidence across OCR passes", () => {
  const merged = mergeCardTextSignals([
    extractCardTextSignals("Pikachu HP 60"),
    null,
    extractCardTextSignals("025/102 Base Set"),
    extractCardTextSignals("Base Set 025/102"),
  ])

  assert.ok(merged)
  assert.deepEqual(merged?.collectorNumbers, ["25/102", "25", "102"])
  assert.equal(merged?.words.has("pikachu"), true)
  assert.equal(merged?.words.has("base"), true)
  assert.match(merged?.rawText ?? "", /Pikachu/)
})
