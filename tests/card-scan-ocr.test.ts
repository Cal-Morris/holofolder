import test from "node:test"
import assert from "node:assert/strict"
import { getCardOcrRegions } from "../lib/card-scan-ocr"

test("getCardOcrRegions includes full card and collector-number strips", () => {
  const regions = getCardOcrRegions(1000, 1400)

  assert.deepEqual(regions.map((region) => region.key), ["full", "bottom", "number-left", "number-right"])
  assert.deepEqual(regions[0], { key: "full", x: 0, y: 0, width: 1000, height: 1400 })
  assert.ok((regions[1]?.y ?? 0) > 700)
  assert.ok((regions[2]?.width ?? 0) < 650)
  assert.ok((regions[3]?.x ?? 0) > 350)
})

test("getCardOcrRegions clamps small images to useful positive crop sizes", () => {
  const regions = getCardOcrRegions(80, 112)

  assert.equal(regions.length, 4)
  for (const region of regions) {
    assert.ok(region.width > 0)
    assert.ok(region.height > 0)
    assert.ok(region.x >= 0)
    assert.ok(region.y >= 0)
    assert.ok(region.x + region.width <= 80)
    assert.ok(region.y + region.height <= 112)
  }
})
