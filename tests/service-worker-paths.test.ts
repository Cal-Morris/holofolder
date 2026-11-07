import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"

function worker() {
  const listeners = new Map<string, (event: unknown) => void>()
  const context = createContext({ URL, self: { location: { origin: "https://holofolder.com" }, addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn) } })
  runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context)
  return { context, listeners }
}

test("offline shell discovers prefixed build assets and lazy chunks", () => {
  const { context } = worker()
  assert.equal(runInContext(`getAppShellAssetUrls('<script src="/app/_next/static/chunks/test.js?dpl=abc"></script>')[0]`, context), "/app/_next/static/chunks/test.js?dpl=abc")
  assert.equal(runInContext(`getReferencedChunkPaths('"static/chunks/lazy.js"', '?dpl=abc')[0]`, context), "/app/_next/static/chunks/lazy.js?dpl=abc")
})

test("worker leaves Framer marketing navigations alone even with an older broad registration", () => {
  const { listeners } = worker()
  for (const pathname of ["/", "/pricing", "/application"]) {
    let intercepted = false
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: `https://holofolder.com${pathname}` }, respondWith: () => { intercepted = true } })
    assert.equal(intercepted, false, pathname)
  }
})
