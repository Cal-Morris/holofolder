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
  for (const pathname of ["/", "/pricing", "/application", "/@cal/national"]) {
    let intercepted = false
    listeners.get("fetch")!({ request: { method: "GET", mode: "navigate", url: `https://holofolder.com${pathname}` }, respondWith: () => { intercepted = true } })
    assert.equal(intercepted, false, pathname)
  }
})

test("failed named share navigations never reveal the private offline binder", async () => {
  const { context } = worker()
  context.fetch = async () => { throw new Error("synthetic offline network") }
  context.caches = { open: async () => ({ match: async () => "synthetic private binder shell" }) }
  for (const path of ["/app/u/cal/national", "/app/share/token", "/@cal/national"]) {
    await assert.rejects(runInContext(`handleNavigation({request:{url:${JSON.stringify(`https://holofolder.com${path}`)}}})`, context), /synthetic offline network/)
  }
})

test("offline shell downloads lazy screens referenced by its scripts", async () => {
  const { context } = worker()
  const entries = new Map<string, Response>([
    ["/app/_next/static/chunks/main.js", new Response('"static/chunks/lazy-screen.js"')],
  ])
  context.cache = {
    match: async (url: string) => entries.get(url)?.clone(),
    put: async (url: string, response: Response) => { entries.set(url, response) },
  }
  context.fetch = async () => new Response("synthetic lazy screen")
  await runInContext('precacheLazyChunks(cache, ["/app/_next/static/chunks/main.js"])', context)
  assert.equal(await entries.get("/app/_next/static/chunks/lazy-screen.js")?.text(), "synthetic lazy screen")
})
