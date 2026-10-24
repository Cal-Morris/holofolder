import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { reachableScrollTop, ViewScrollMemory, VIEW_SCROLL_STORAGE_KEY, type ScrollStore } from "../lib/view-scroll-memory"

function memoryStore(): ScrollStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) }
}

describe("view scroll memory", () => {
  it("keeps one position per view and scope", () => {
    const store = memoryStore()
    const memory = new ViewScrollMemory(() => store, "/binder")
    memory.set("list", 840.4)
    memory.set("sets", 120)
    assert.equal(memory.get("list"), 840)
    assert.equal(memory.get("sets"), 120)
    assert.equal(memory.get("wanted"), 0)
    assert.equal(new ViewScrollMemory(() => store, "/other").get("list"), 0)
  })

  it("survives a reload through storage and forgets positions back at the top", () => {
    const store = memoryStore()
    new ViewScrollMemory(() => store, "/b").set("list", 300)
    const reloaded = new ViewScrollMemory(() => store, "/b")
    assert.equal(reloaded.get("list"), 300)
    reloaded.set("list", 0)
    assert.equal(JSON.parse(store.data.get(VIEW_SCROLL_STORAGE_KEY)!)["/b|list"], undefined)
  })

  it("ignores corrupt or missing storage", () => {
    const store = memoryStore()
    store.data.set(VIEW_SCROLL_STORAGE_KEY, "{not json")
    assert.equal(new ViewScrollMemory(() => store).get("list"), 0)
    const none = new ViewScrollMemory(() => null)
    none.set("list", 50)
    assert.equal(none.get("list"), 50)
  })

  it("clamps to what the scroller can reach", () => {
    assert.equal(reachableScrollTop(900, 1000, 400), 600)
    assert.equal(reachableScrollTop(200, 1000, 400), 200)
    assert.equal(reachableScrollTop(200, 300, 400), 0)
  })
})
