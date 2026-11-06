import { test } from "node:test"
import assert from "node:assert/strict"
import { BinderSlotImages } from "../lib/binder-slot-images"

test("page turns reuse and promote pending decodes, retain images and retry failures", async () => {
  const original = globalThis.Image
  const images: FakeImage[] = []
  class FakeImage {
    src = ""
    decoding = ""
    fetchPriority = ""
    removed = false
    resolve!: () => void
    reject!: () => void
    promise = new Promise<void>((resolve, reject) => { this.resolve = resolve; this.reject = reject })
    constructor() { images.push(this) }
    decode() { return this.promise }
    removeAttribute() { this.removed = true; this.reject() }
  }
  globalThis.Image = FakeImage as unknown as typeof Image
  try {
    const cache = new BinderSlotImages()
    const prefetch = cache.load("next")
    assert.equal(cache.load("next", "high"), prefetch)
    assert.equal(images.length, 1)
    assert.equal(images[0].fetchPriority, "high")
    cache.retain(new Set(["next"]))
    assert.equal(images[0].removed, false)
    images[0].resolve()
    await prefetch
    assert.equal(cache.load("next"), prefetch)
    cache.retain(new Set())
    assert.equal(images[0].removed, true)
    const failed = cache.load("bad")
    images[1].reject()
    await failed
    const retry = cache.load("bad")
    assert.equal(images.length, 3)
    images[2].resolve()
    await retry
  } finally { globalThis.Image = original }
})
