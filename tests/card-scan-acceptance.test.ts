import test from "node:test"
import assert from "node:assert/strict"
import { evaluateCardScanAutoAccept } from "../lib/card-scan-acceptance"

test("evaluateCardScanAutoAccept accepts confident matches with a clear ranking margin", () => {
  const decision = evaluateCardScanAutoAccept({
    similarity: 0.63,
    confidence: 0.68,
    margin: 0.08,
    appearanceRatio: 0.5,
  })

  assert.equal(decision.autoAccept, true)
  assert.equal(decision.reason, "clear-margin")
})

test("evaluateCardScanAutoAccept rejects close ties even when similarity and confidence clear old thresholds", () => {
  const decision = evaluateCardScanAutoAccept({
    similarity: 0.63,
    confidence: 0.68,
    margin: 0.012,
    appearanceRatio: 0.5,
  })

  assert.equal(decision.autoAccept, false)
  assert.equal(decision.reason, "ambiguous-margin")
})

test("evaluateCardScanAutoAccept accepts very strong repeated evidence without much margin", () => {
  const decision = evaluateCardScanAutoAccept({
    similarity: 0.72,
    confidence: 0.86,
    margin: 0.018,
    appearanceRatio: 0.82,
  })

  assert.equal(decision.autoAccept, true)
  assert.equal(decision.reason, "strong-repeat")
})

test("evaluateCardScanAutoAccept rejects weak visual evidence", () => {
  const decision = evaluateCardScanAutoAccept({
    similarity: 0.52,
    confidence: 0.88,
    margin: 0.2,
    appearanceRatio: 1,
  })

  assert.equal(decision.autoAccept, false)
  assert.equal(decision.reason, "weak-similarity")
})
