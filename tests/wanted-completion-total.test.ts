import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { wantedCompletionTotal } from "@/lib/wanted-dashboard"
import type { CardPriceSnapshot } from "@/hooks/use-card-prices"

// Synthetic prices only.
const price = (confidence: string) => ({ confidence }) as unknown as CardPriceSnapshot

describe("want list completion total", () => {
  test("adds only prices reliable enough to total, and counts the rest as unknown", () => {
    const total = wantedCompletionTotal([
      { effectiveGbpAmount: 10, price: price("high") },
      { effectiveGbpAmount: 2.5, price: price("medium") },
      { effectiveGbpAmount: 400, price: price("low") },
      { effectiveGbpAmount: 7, price: undefined },
      { effectiveGbpAmount: null, price: price("high") },
    ])
    assert.deepEqual(total, { totalGbp: 12.5, priced: 2, unknown: 3 })
  })

  test("an empty or wholly unpriced list has no total", () => {
    assert.deepEqual(wantedCompletionTotal([]), { totalGbp: 0, priced: 0, unknown: 0 })
    assert.deepEqual(wantedCompletionTotal([{ effectiveGbpAmount: null, price: undefined }]), { totalGbp: 0, priced: 0, unknown: 1 })
  })
})
