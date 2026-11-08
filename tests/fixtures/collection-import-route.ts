import assert from "node:assert/strict"

async function run() {
  // @ts-expect-error Bun module mocks are confined to this subprocess.
  const { mock } = await import("bun:test")
  let calls = 0, active = 0, peak = 0
  mock.module("../../lib/tcg-mirror", () => ({ findMirroredImportCandidates: async () => { calls++; active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return [] } }))
  const { POST } = await import("../../app/api/collection-import/resolve/route")
  const lookup = { language: "en", finish: "normal", list: "owned", cardId: "synthetic-44" }
  const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://synthetic.test/app/api/collection-import/resolve", { method: "POST", headers: { origin: "https://synthetic.test", ...headers }, body: JSON.stringify(body) })
  assert.equal((await POST(request({ lookups: [lookup] }, { origin: "https://elsewhere.test" }))).status, 403)
  assert.equal((await POST(request({ lookups: [lookup] }, { "sec-fetch-site": "cross-site" }))).status, 403)
  assert.equal((await POST(request({ lookups: Array(26).fill(lookup) }))).status, 400)
  assert.equal((await POST(request({ lookups: [{ ...lookup, cells: ["private"] }] }))).status, 400)
  assert.equal((await POST(request({ lookups: [lookup] }, { "content-length": "65537" }))).status, 413)
  assert.equal(calls, 0)
  const response = await POST(request({ lookups: Array(25).fill(lookup) }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "private, no-store")
  assert.equal((await response.json()).results.length, 25)
  assert.equal(calls, 25)
  assert.ok(peak <= 3)
  mock.restore()
}
void run().catch(error => { console.error(error); process.exitCode = 1 })
