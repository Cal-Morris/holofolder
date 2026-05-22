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

test("extractCardTextSignals preserves prefixed collector numbers from trainer gallery style cards", () => {
  const signals = extractCardTextSignals("Trainer Gallery TG05/TG30\\nIllustration rare")

  assert.deepEqual(signals.collectorNumbers, ["tg5/tg30", "tg5", "tg30", "5/30", "5", "30"])
})

test("extractCardTextSignals normalizes OCR-confused collector digits", () => {
  const signals = extractCardTextSignals("Trainer Gallery TGOS/TG3O")

  assert.deepEqual(signals.collectorNumbers, ["tg5/tg30", "tg5", "tg30", "5/30", "5", "30"])
})

test("extractCardTextSignals recovers collector numbers when OCR drops the slash", () => {
  const signals = extractCardTextSignals("Pikachu HP 60 025 102 Base Set")

  assert.deepEqual(signals.collectorNumbers, ["25/102", "25", "102"])
})

test("extractCardTextSignals reads standalone prefixed promo and gallery numbers", () => {
  const signals = extractCardTextSignals("Black Star Promo SWSH001\\nTrainer Gallery TG05")

  assert.deepEqual(signals.collectorNumbers, ["swsh1", "1", "tg5", "5"])
})

test("extractCardTextSignals does not invent collector numbers from slash-separated words", () => {
  const signals = extractCardTextSignals("weakness/resistance loss/boss illustrator")

  assert.deepEqual(signals.collectorNumbers, [])
})

test("extractCardTextSignals does not treat HP text as a standalone collector number", () => {
  const signals = extractCardTextSignals("Pikachu HP60 Weakness")

  assert.deepEqual(signals.collectorNumbers, [])
})

test("scoreCardTextSignals rewards prefixed localId matches over plain number collisions", () => {
  const signals = extractCardTextSignals("TG05/TG30")
  const prefixedCard = { id: "tg", name: "Pikachu", localId: "TG05", set: { id: "swsh11tg", name: "Trainer Gallery" } }
  const plainCard = { id: "plain", name: "Pikachu", localId: "005", set: { id: "base1", name: "Base Set" } }

  assert.ok(scoreCardTextSignals(signals, prefixedCard) > scoreCardTextSignals(signals, plainCard))
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

test("applyCardTextSignalBoost can admit strong text-only collector matches", () => {
  const signals = extractCardTextSignals("TG05/TG30")
  const boosted = applyCardTextSignalBoost(
    [
      { card: { id: "visual", name: "Pikachu", localId: "006", set: { id: "base1", name: "Base Set" } }, similarity: 0.63 },
    ],
    signals,
    {
      candidateCards: [
        { id: "visual", name: "Pikachu", localId: "006", set: { id: "base1", name: "Base Set" } },
        { id: "text", name: "Pikachu", localId: "TG05", set: { id: "swsh11tg", name: "Trainer Gallery" } },
      ],
      getCardId: (card) => card.id,
    },
  )

  assert.equal(boosted[0].card.id, "text")
  assert.ok(boosted[0].textScore > 0.5)
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
