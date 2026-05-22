import test from "node:test"
import assert from "node:assert/strict"
import {
  aggregateBinderPageScanResults,
  buildAggregatedBinderPageScanPreview,
} from "../lib/binder-page-scan-aggregate"
import type { BinderPageScanResult } from "../lib/binder-page-scan"

function makeResult(occupiedSlots: number[], confidenceBySlot: Record<number, number> = {}): BinderPageScanResult {
  return {
    width: 400,
    height: 560,
    grid: { x: 0, y: 0, width: 400, height: 560, confidence: 1 },
    previewDataUrl: "data:image/jpeg;base64,test",
    slots: Array.from({ length: 4 }, (_, index) => ({
      index,
      row: Math.floor(index / 2),
      col: index % 2,
      x: (index % 2) * 100,
      y: Math.floor(index / 2) * 140,
      width: 100,
      height: 140,
      occupied: occupiedSlots.includes(index),
      score: occupiedSlots.includes(index) ? 1 : 0,
      confidence: confidenceBySlot[index] ?? (occupiedSlots.includes(index) ? 0.8 : 0.2),
      metrics: {
        meanLuminance: 0,
        luminanceStdDev: 0,
        chromaMean: 0,
        chromaStdDev: 0,
        darkPixelRatio: 0,
        neutralPixelRatio: 0,
        whitePixelRatio: 0,
        blackNeutralPixelRatio: 0,
        edgeRatio: 0,
        strongEdgeRatio: 0,
        chromaEdgeRatio: 0,
        saturationMean: 0,
        vividColorRatio: 0,
        highlightRatio: 0,
        centerLuminanceStdDev: 0,
        centerStrongEdgeRatio: 0,
        centerVividColorRatio: 0,
        centerHighlightRatio: 0,
        activeQuadrantRatio: 0,
      },
      cardImageDataUrl: occupiedSlots.includes(index) ? `slot-${index}` : undefined,
    })),
  }
}

test("aggregateBinderPageScanResults keeps slots that are stable across a jittery burst", () => {
  const aggregated = aggregateBinderPageScanResults(
    [
      makeResult([0, 2]),
      makeResult([0, 2]),
      makeResult([2]),
      makeResult([0]),
    ],
    { voteRatio: 0.45 },
  )

  assert.equal(aggregated.requiredVotes, 2)
  assert.equal(aggregated.slots[0].occupied, true)
  assert.equal(aggregated.slots[2].occupied, true)
  assert.equal(aggregated.slots[1].occupied, false)
})

test("buildAggregatedBinderPageScanPreview shows accumulated occupancy instead of the last noisy frame", () => {
  const preview = buildAggregatedBinderPageScanPreview(
    [
      makeResult([0]),
      makeResult([0]),
      makeResult([]),
    ],
    { voteRatio: 0.45 },
  )

  assert.ok(preview)
  assert.equal(preview?.slots[0].occupied, true)
  assert.equal(preview?.slots[0].cardImageDataUrl, undefined)
  assert.equal(preview?.slots[1].occupied, false)
})
