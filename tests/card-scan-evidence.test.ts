import test from "node:test"
import assert from "node:assert/strict"
import { selectCardScanEvidenceImages, type CardScanImageCandidate } from "../lib/card-scan-evidence"

test("selectCardScanEvidenceImages prefers the highest quality crops over capture order", () => {
  const selected = selectCardScanEvidenceImages(
    [
      { dataUrl: "blurred-first", quality: 0.18 },
      { dataUrl: "sharp-second", quality: 0.92 },
      { dataUrl: "usable-third", quality: 0.74 },
    ],
    2,
  )

  assert.deepEqual(selected, ["sharp-second", "usable-third"])
})

test("selectCardScanEvidenceImages keeps stable ordering for equal quality and ignores duplicate crops", () => {
  const candidates: CardScanImageCandidate[] = [
    { dataUrl: "first", quality: 0.7 },
    { dataUrl: "duplicate-lower", quality: 0.3 },
    { dataUrl: "first", quality: 0.9 },
    { dataUrl: "second", quality: 0.7 },
  ]

  assert.deepEqual(selectCardScanEvidenceImages(candidates, 3), ["first", "second", "duplicate-lower"])
})
