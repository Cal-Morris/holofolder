import test from "node:test"
import assert from "node:assert/strict"
import { aggregateBinderSlotSweep, getNextSweepSlotIndex, type BinderSlotSweepFrame } from "../lib/binder-slot-sweep"
import type { CardScanFrameMatch } from "../lib/card-scan-matching"

type TestCard = {
  id: string
  name: string
}

const alpha = { id: "alpha", name: "Alpha" }
const beta = { id: "beta", name: "Beta" }
const gamma = { id: "gamma", name: "Gamma" }

function match(card: TestCard, similarity: number): CardScanFrameMatch<TestCard> {
  return { card, similarity }
}

function frame(slotIndex: number, matches: CardScanFrameMatch<TestCard>[]): BinderSlotSweepFrame<TestCard> {
  return { slotIndex, matches }
}

test("aggregateBinderSlotSweep locks a slot from stable repeated matches", () => {
  const result = aggregateBinderSlotSweep(
    [
      frame(0, [match(alpha, 0.82), match(beta, 0.88)]),
      frame(0, [match(alpha, 0.84), match(gamma, 0.89)]),
      frame(0, [match(alpha, 0.83)]),
      frame(1, [match(beta, 0.81)]),
      frame(1, [match(beta, 0.83)]),
    ],
    {
      slotCount: 4,
      getCardId: (card) => card.id,
      minimumFramesPerSlot: 2,
      minimumAppearanceRatio: 0.5,
      minimumConfidence: 0.5,
      minimumSimilarity: 0.72,
    },
  )

  assert.equal(result.slots[0]?.state, "matched")
  assert.equal(result.slots[0]?.match?.card.id, "alpha")
  assert.equal(result.slots[0]?.frames, 3)
  assert.equal(result.slots[1]?.state, "matched")
  assert.equal(result.matchedSlots, 2)
})

test("aggregateBinderSlotSweep does not mark weak or under-sampled slots as matched", () => {
  const result = aggregateBinderSlotSweep(
    [
      frame(0, [match(alpha, 0.92)]),
      frame(1, [match(beta, 0.51)]),
      frame(1, [match(beta, 0.52)]),
      frame(2, []),
      frame(2, []),
    ],
    {
      slotCount: 3,
      getCardId: (card) => card.id,
      minimumFramesPerSlot: 2,
      minimumAppearanceRatio: 0.5,
      minimumConfidence: 0.5,
      minimumSimilarity: 0.72,
    },
  )

  assert.equal(result.slots[0]?.state, "needs-more-frames")
  assert.equal(result.slots[1]?.state, "uncertain")
  assert.equal(result.slots[2]?.state, "empty")
  assert.equal(result.matchedSlots, 0)
})

test("aggregateBinderSlotSweep bases appearance requirements on frames above the similarity floor", () => {
  const result = aggregateBinderSlotSweep(
    [
      frame(0, [match(alpha, 0.8)]),
      frame(0, [match(alpha, 0.82)]),
      frame(0, [match(beta, 0.52)]),
    ],
    {
      slotCount: 1,
      getCardId: (card) => card.id,
      minimumFramesPerSlot: 3,
      minimumAppearanceRatio: 0.75,
      minimumFrameSimilarity: 0.56,
      minimumConfidence: 0.5,
      minimumSimilarity: 0.72,
    },
  )

  assert.equal(result.slots[0]?.usableFrames, 2)
  assert.equal(result.slots[0]?.state, "matched")
  assert.equal(result.slots[0]?.match?.card.id, "alpha")
  assert.equal(result.slots[0]?.match?.appearanceRatio, 1)
})

test("getNextSweepSlotIndex skips empty page slots and wraps inside the page", () => {
  const pageSlots = [null, { id: 1 }, null, { id: 2 }, { id: 3 }, null]

  assert.equal(getNextSweepSlotIndex(pageSlots, 0, new Set()), 1)
  assert.equal(getNextSweepSlotIndex(pageSlots, 1, new Set([1])), 3)
  assert.equal(getNextSweepSlotIndex(pageSlots, 4, new Set([1, 3, 4])), null)
})
