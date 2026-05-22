import test from "node:test"
import assert from "node:assert/strict"
import {
  aggregateCardScanMatches,
  aggregatePageSlotScanMatches,
  type CardScanFrameMatch,
} from "../lib/card-scan-matching"

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

test("aggregateCardScanMatches rewards stable multi-frame matches over one-off high scores", () => {
  const aggregated = aggregateCardScanMatches<TestCard>(
    [
      [match(alpha, 0.84), match(beta, 0.96)],
      [match(alpha, 0.82), match(gamma, 0.91)],
      [match(alpha, 0.83)],
      [match(alpha, 0.8)],
    ],
    {
      getCardId: (card) => card.id,
      minimumAppearances: 2,
      maxResults: 3,
    },
  )

  assert.equal(aggregated[0]?.card.id, "alpha")
  assert.equal(aggregated[0]?.appearances, 4)
  assert.ok(aggregated[0]?.confidence > 0.7)
  assert.equal(aggregated.some((entry) => entry.card.id === "beta"), false)
})

test("aggregateCardScanMatches keeps a close second when it is stable enough", () => {
  const aggregated = aggregateCardScanMatches<TestCard>(
    [
      [match(alpha, 0.9), match(beta, 0.88)],
      [match(alpha, 0.89), match(beta, 0.87)],
      [match(beta, 0.9), match(alpha, 0.86)],
    ],
    {
      getCardId: (card) => card.id,
      minimumAppearances: 2,
      maxResults: 2,
    },
  )

  assert.deepEqual(aggregated.map((entry) => entry.card.id), ["alpha", "beta"])
  assert.ok(aggregated[0].margin < 0.1)
})

test("aggregateCardScanMatches counts duplicate card candidates once per frame", () => {
  const aggregated = aggregateCardScanMatches<TestCard>(
    [
      [match(alpha, 0.9), match(alpha, 0.82), match(beta, 0.72)],
      [match(beta, 0.74)],
    ],
    {
      getCardId: (card) => card.id,
      minimumAppearances: 2,
      maxResults: 3,
    },
  )

  assert.equal(aggregated.some((entry) => entry.card.id === "alpha"), false)
  assert.equal(aggregated[0]?.card.id, "beta")
  assert.equal(aggregated[0]?.appearances, 2)
})

test("aggregatePageSlotScanMatches aggregates each binder slot independently", () => {
  const slots = aggregatePageSlotScanMatches<TestCard>(
    [
      {
        slotIndex: 0,
        frameMatches: [
          [match(alpha, 0.82), match(beta, 0.7)],
          [match(alpha, 0.8)],
          [match(alpha, 0.84)],
        ],
      },
      {
        slotIndex: 1,
        frameMatches: [
          [match(gamma, 0.83)],
          [match(beta, 0.86), match(gamma, 0.8)],
          [match(beta, 0.85)],
        ],
      },
    ],
    {
      getCardId: (card) => card.id,
      minimumAppearances: 2,
      maxResultsPerSlot: 2,
    },
  )

  assert.equal(slots[0]?.slotIndex, 0)
  assert.equal(slots[0]?.matches[0]?.card.id, "alpha")
  assert.equal(slots[1]?.slotIndex, 1)
  assert.equal(slots[1]?.matches[0]?.card.id, "beta")
})
