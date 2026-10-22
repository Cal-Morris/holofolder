import { describe, test } from "node:test"
import assert from "node:assert/strict"
import {
  DEFAULT_DEAL_THRESHOLDS,
  RISING_NOTE,
  THIN_DATA_NOTE,
  checkBundle,
  checkDeal,
  normalizeDealThresholds,
  parseAskingPrice,
  parseDealThresholds,
} from "@/lib/deal-check"

const verdict = (askingPrice: number, marketPrice: number) => checkDeal({ askingPrice, marketPrice })?.verdict

describe("checkDeal bands (default thresholds)", () => {
  test("Callum's example: £6 in a binder is bad against a £4 average, good against £10", () => {
    assert.equal(verdict(6, 4), "walk-away")
    assert.equal(verdict(6, 10), "great")
  })
  test("band edges", () => {
    assert.equal(verdict(8, 10), "great") // exactly 20% under
    assert.equal(verdict(8.01, 10), "good")
    assert.equal(verdict(8.99, 10), "good")
    assert.equal(verdict(9, 10), "fair") // exactly 10% under
    assert.equal(verdict(10, 10), "fair")
    assert.equal(verdict(11, 10), "fair") // exactly 10% over
    assert.equal(verdict(11.01, 10), "overpriced")
    assert.equal(verdict(13.49, 10), "overpriced")
    assert.equal(verdict(13.5, 10), "walk-away") // exactly 35% over
  })
  test("reports the % and money difference and the price lines", () => {
    const deal = checkDeal({ askingPrice: 6, marketPrice: 4 })!
    assert.equal(deal.diffPct, 50)
    assert.equal(deal.diffAmount, 2)
    assert.equal(deal.payUpTo, 4.4)
    assert.equal(deal.goodBelow, 3.6)
    assert.equal(deal.greatAt, 3.2)
    assert.equal(deal.label, "Walk away")
  })
  test("no verdict without a market price or an asking price", () => {
    assert.equal(checkDeal({ askingPrice: 5, marketPrice: null }), null)
    assert.equal(checkDeal({ askingPrice: 5, marketPrice: 0 }), null)
    assert.equal(checkDeal({ askingPrice: 0, marketPrice: 5 }), null)
  })
  test("custom thresholds move the bands", () => {
    const thresholds = { greatPct: 30, fairPct: 5, walkAwayPct: 20 }
    assert.equal(checkDeal({ askingPrice: 8, marketPrice: 10, thresholds })?.verdict, "good")
    assert.equal(checkDeal({ askingPrice: 10.6, marketPrice: 10, thresholds })?.verdict, "overpriced")
    assert.equal(checkDeal({ askingPrice: 12, marketPrice: 10, thresholds })?.verdict, "walk-away")
  })
})

describe("checkDeal notes", () => {
  test("flags thin and stale data", () => {
    assert.deepEqual(checkDeal({ askingPrice: 5, marketPrice: 5, confidence: "low", dataAgeDays: 12.4 })!.notes, [THIN_DATA_NOTE, "Price data is 12 days old"])
    assert.deepEqual(checkDeal({ askingPrice: 5, marketPrice: 5, confidence: "high", dataAgeDays: 2 })!.notes, [])
  })
  test("a rising card nudges an overpriced verdict only", () => {
    assert.deepEqual(checkDeal({ askingPrice: 12, marketPrice: 10, isRising: true })!.notes, [RISING_NOTE])
    assert.deepEqual(checkDeal({ askingPrice: 10, marketPrice: 10, isRising: true })!.notes, [])
    assert.deepEqual(checkDeal({ askingPrice: 20, marketPrice: 10, isRising: true })!.notes, [])
  })
})

describe("thresholds", () => {
  test("defaults for missing or broken values", () => {
    assert.deepEqual(parseDealThresholds(null), DEFAULT_DEAL_THRESHOLDS)
    assert.deepEqual(parseDealThresholds("{"), DEFAULT_DEAL_THRESHOLDS)
    assert.deepEqual(parseDealThresholds('{"fairPct":"x"}'), DEFAULT_DEAL_THRESHOLDS)
  })
  test("keeps the bands ordered", () => {
    assert.deepEqual(normalizeDealThresholds({ greatPct: 5, fairPct: 15, walkAwayPct: 10 }), { greatPct: 16, fairPct: 15, walkAwayPct: 16 })
    assert.deepEqual(normalizeDealThresholds({ greatPct: 200, fairPct: 0, walkAwayPct: 9999 }), { greatPct: 90, fairPct: 1, walkAwayPct: 500 })
  })
})

describe("parseAskingPrice", () => {
  test("reads keypad and typed amounts", () => {
    assert.equal(parseAskingPrice("6"), 6)
    assert.equal(parseAskingPrice("£6.50"), 6.5)
    assert.equal(parseAskingPrice("6,50"), 6.5)
    assert.equal(parseAskingPrice("1,200"), 1200)
    assert.equal(parseAskingPrice("1,200.50"), 1200.5)
    assert.equal(parseAskingPrice(""), null)
    assert.equal(parseAskingPrice("0"), null)
    assert.equal(parseAskingPrice("1.2.3"), null)
  })
})

describe("checkBundle", () => {
  test("judges one asking total against the combined market price", () => {
    const bundle = checkBundle([{ marketPrice: 4 }, { marketPrice: 6 }], 8)
    assert.equal(bundle.marketTotal, 10)
    assert.equal(bundle.unpricedCount, 0)
    assert.equal(bundle.deal?.verdict, "great") // £8 for £10 of cards: 20% under
    assert.equal(bundle.deal?.payUpTo, 11)
  })

  test("notes unpriced cards and gives no verdict without an asking total", () => {
    const bundle = checkBundle([{ marketPrice: 10 }, { marketPrice: null }], 14)
    assert.equal(bundle.unpricedCount, 1)
    assert.equal(bundle.deal?.verdict, "walk-away")
    assert.match(bundle.deal?.notes[0] ?? "", /1 card has no price/)
    assert.equal(checkBundle([{ marketPrice: 10 }], null).deal, null)
    assert.equal(checkBundle([{ marketPrice: null }], 5).deal, null)
  })
})
