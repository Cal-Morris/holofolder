import test from "node:test"
import assert from "node:assert/strict"
import {
  applyCardTextSignalBoost,
  buildCardMetadataTextSignals,
  extractCardTextSignals,
  mergeCardTextSignals,
  scoreCardTextEvidence,
  scoreCardTextSignalSimilarity,
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

test("buildCardMetadataTextSignals includes useful card metadata as OCR fallback evidence", () => {
  const signals = buildCardMetadataTextSignals({
    name: "Pikachu",
    localId: "TG05",
    set: { id: "swsh11tg", name: "Trainer Gallery" },
    rarity: "Illustration Rare",
    hp: 60,
    types: ["Lightning"],
    illustrator: "Mitsuhiro Arita",
    variants: { holo: true, reverse: false },
  })

  assert.ok(signals.collectorNumbers.includes("tg5"))
  assert.equal(signals.words.has("pikachu"), true)
  assert.equal(signals.words.has("lightning"), true)
  assert.equal(signals.words.has("mitsuhiro"), true)
  assert.equal(signals.words.has("holo"), true)
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

test("scoreCardTextSignalSimilarity fuzzily compares OCR text from scanned and candidate card images", () => {
  const querySignals = extractCardTextSignals("Pikachu Thundr Jolt Flip a coin 063/165")
  const candidateSignals = extractCardTextSignals("Pikachu Thunder Jolt Flip a coin 063/165")
  const wrongCandidateSignals = extractCardTextSignals("Squirtle Bubble Beam Water Gun 007/102")

  assert.ok(scoreCardTextSignalSimilarity(querySignals, candidateSignals) > 0.72)
  assert.ok(scoreCardTextSignalSimilarity(querySignals, wrongCandidateSignals) < 0.45)
})

test("scoreCardTextSignalSimilarity prefers full collector numbers over local-number collisions", () => {
  const querySignals = extractCardTextSignals("Pikachu 025/102 Base Set Thunder Jolt")
  const exactSignals = extractCardTextSignals("Pikachu 025/102 Base Set Thunder Jolt")
  const collisionSignals = extractCardTextSignals("Pikachu 025/198 Scarlet Violet Static Shock")

  assert.ok(scoreCardTextSignalSimilarity(querySignals, exactSignals) > scoreCardTextSignalSimilarity(querySignals, collisionSignals) + 0.22)
})

test("scoreCardTextSignalSimilarity tolerates OCR digit and word noise from candidate assets", () => {
  const querySignals = extractCardTextSignals("Trainer Gallery TGOS/TG3O Pikachn Thunderbolt")
  const candidateSignals = extractCardTextSignals("Trainer Gallery TG05/TG30 Pikachu Thunderbolt")

  assert.ok(scoreCardTextSignalSimilarity(querySignals, candidateSignals) > 0.78)
})

test("scoreCardTextSignalSimilarity uses card-specific attack text to split similar Pokemon cards", () => {
  const querySignals = extractCardTextSignals("Charmander Ember Flare Tail 004/102")
  const rightSignals = extractCardTextSignals("Charmander Ember Flare Tail 004/102")
  const samePokemonWrongMoveSignals = extractCardTextSignals("Charmander Scratch Firebreathing 004/102")

  assert.ok(scoreCardTextSignalSimilarity(querySignals, rightSignals) > scoreCardTextSignalSimilarity(querySignals, samePokemonWrongMoveSignals) + 0.14)
})

test("scoreCardTextSignalSimilarity does not over-rank card boilerplate OCR", () => {
  const querySignals = extractCardTextSignals("Pokemon HP Weakness Resistance Retreat Energy")
  const candidateSignals = extractCardTextSignals("Pokemon HP Weakness Resistance Retreat Energy")

  assert.ok(scoreCardTextSignalSimilarity(querySignals, candidateSignals) < 0.42)
})

test("applyCardTextSignalBoost can promote candidate asset OCR when visual ranking misses it", () => {
  const querySignals = extractCardTextSignals("Raging Surf Hydro Pump 063/165")
  const visualCard = { id: "visual", name: "Pikachu", localId: "001", set: { id: "sv1", name: "Scarlet & Violet" } }
  const assetCard = { id: "asset", name: "Pikachu", localId: "088", set: { id: "sv3", name: "Obsidian Flames" } }
  const boosted = applyCardTextSignalBoost(
    [{ card: visualCard, similarity: 0.68 }],
    querySignals,
    {
      candidateCards: [visualCard, assetCard],
      candidateTextSignals: new Map([
        [assetCard.id, extractCardTextSignals("Raging Surf Hydro Pump 063/165")],
      ]),
      getCardId: (card) => card.id,
      minimumTextOnlyScore: 0.5,
    },
  )

  assert.equal(boosted[0].card.id, "asset")
  assert.ok(scoreCardTextEvidence(querySignals, assetCard, extractCardTextSignals("Raging Surf Hydro Pump 063/165")) > 0.7)
})

test("applyCardTextSignalBoost uses candidate asset OCR to reorder close visual matches", () => {
  const querySignals = extractCardTextSignals("Mewtwo Psyburn Barrier 150/165")
  const wrongVisualCard = { id: "wrong", name: "Mewtwo", localId: "150", set: { id: "sv2", name: "Paldea Evolved" } }
  const rightAssetCard = { id: "right", name: "Mewtwo", localId: "151", set: { id: "sv3", name: "Obsidian Flames" } }
  const boosted = applyCardTextSignalBoost(
    [
      { card: wrongVisualCard, similarity: 0.72 },
      { card: rightAssetCard, similarity: 0.66 },
    ],
    querySignals,
    {
      candidateTextSignals: new Map([
        [wrongVisualCard.id, extractCardTextSignals("Mewtwo Mind Bend Telekinesis 099/198")],
        [rightAssetCard.id, extractCardTextSignals("Mewtwo Psyburn Barrier 150/165")],
      ]),
      getCardId: (card) => card.id,
    },
  )

  assert.equal(boosted[0].card.id, "right")
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
