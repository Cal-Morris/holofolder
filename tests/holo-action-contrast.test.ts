import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const luminance = (hex: string) => {
  const channels = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
}

test("holo actions use off-white text with at least 4.5:1 contrast at every gradient stop", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  const action = css.match(/\.holo-action\s*\{([^}]+)\}/)?.[1] ?? ""
  assert.match(action, /color:\s*#f4f3f8/)
  const background = action.match(/background-image:\s*([^;]+);/)?.[1] ?? ""
  const stops = background.match(/#[0-9a-f]{6}/g) ?? []
  assert.ok(stops.length >= 3)
  const foreground = luminance("#f4f3f8")
  for (const stop of stops) assert.ok((foreground + 0.05) / (luminance(stop) + 0.05) >= 4.5, `Low contrast on ${stop}`)
})
