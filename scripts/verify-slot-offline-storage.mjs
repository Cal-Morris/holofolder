import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { chromium } from "@playwright/test"

// Isolated Chromium storage only. No app server, network, real accounts, SW or hosted writes.
const dir = await mkdtemp(join(tmpdir(), "holofolder-slot-storage-"))
let browser
try {
  const output = join(dir, "proof.js")
  const build = spawnSync("bun", ["build", "tests/fixtures/slot-offline-browser.ts", "--target=browser", `--outfile=${output}`], { encoding: "utf8" })
  assert.equal(build.status, 0, build.stderr)
  const bundle = await readFile(output, "utf8")
  assert.doesNotMatch(bundle, /SUPABASE_SERVICE_ROLE_KEY|lib\/server\/|Buffer\.byteLength/)
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  for (const [width, height] of [[375, 667], [390, 844], [430, 932]]) {
    for (const standalone of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" })
      await context.addInitScript(({ standalone }) => {
        const matchMedia = window.matchMedia.bind(window)
        window.matchMedia = query => query === "(display-mode: standalone)" ? { ...matchMedia(query), matches: standalone, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, onchange: null } : matchMedia(query)
      }, { standalone })
      await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic storage proof</title>" }))
      const page = await context.newPage()
      const open = async target => { await target.goto("https://synthetic-slot-offline.test"); await target.addScriptTag({ content: bundle }) }
      await open(page)
      await page.evaluate(() => globalThis.slotOfflineProof.seed())
      await page.evaluate(() => globalThis.slotOfflineProof.append("operation-one", "synthetic-slot-one", 1))
      const tab = await context.newPage(); await open(tab)
      await Promise.all([page.evaluate(() => globalThis.slotOfflineProof.crossTabAppend("tab-a")), tab.evaluate(() => globalThis.slotOfflineProof.crossTabAppend("tab-b"))])
      await assert.rejects(page.evaluate(() => globalThis.slotOfflineProof.abort()), /synthetic-crash/)
      assert.deepEqual((await page.evaluate(() => globalThis.slotOfflineProof.concurrent())).sort(), ["tab-a", "tab-b"])
      await context.setOffline(true)
      await page.reload(); await page.addScriptTag({ content: bundle })
      const record = await page.evaluate(() => globalThis.slotOfflineProof.queue.read())
      assert.equal(record.pending[0].intent.request.operationId, "operation-one")
      assert.equal(record.optimistic.binders[0].slots[0].id, "synthetic-slot-one")
      await page.evaluate(() => globalThis.slotOfflineProof.queue.replay(async () => ({ status: 503 }), () => ({ deviceId: "synthetic-device", workspaceId: "synthetic-workspace", accountId: "synthetic-account", ownerUserId: "synthetic-owner" }), 0))
      assert.equal((await page.evaluate(() => globalThis.slotOfflineProof.queue.read())).pending[0].status, "unavailable")
      assert.deepEqual(await page.evaluate(() => globalThis.slotOfflineProof.legacy()), { pendingOperations: [{ id: "synthetic-legacy" }] })
      console.log(`PASS ${width}x${height} ${standalone ? "emulated-standalone" : "browser"}: IDB commit/abort, two tabs, offline reload, 503 and legacy preservation`)
      await context.close()
    }
  }
} finally {
  await browser?.close()
  await rm(dir, { recursive: true, force: true })
}
