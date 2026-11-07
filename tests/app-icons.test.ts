import { test } from "node:test"
import assert from "node:assert/strict"
import sharp from "sharp"
import manifest from "../app/manifest"

test("install icons are reachable square PNG files with opaque backgrounds", async () => {
  for (const icon of manifest().icons ?? []) {
    assert.equal(icon.type, "image/png")
    const metadata = await sharp(new URL(`../public${icon.src.replace(/^\/app/, "")}`, import.meta.url).pathname).metadata()
    assert.equal(`${metadata.width}x${metadata.height}`, icon.sizes)
    assert.equal(metadata.hasAlpha, false, "Home Screen icons need an opaque background")
  }
})

test("maskable card artwork stays inside the central safe circle", async () => {
  const { data, info } = await sharp(new URL("../public/pwa-holo-card-512.png", import.meta.url).pathname).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const background = data.subarray(0, info.channels)
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (Math.hypot(x - info.width / 2, y - info.height / 2) <= info.width * .4) continue
      const offset = (y * info.width + x) * info.channels
      assert.deepEqual(data.subarray(offset, offset + info.channels), background, "A round icon mask must not crop the card")
    }
  }
})
