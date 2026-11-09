import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { chromium } from "@playwright/test"
import { handleInventoryCompleteRead } from "../lib/server/inventory-read-http"
import { fixture, owner, collection } from "../tests/fixtures/inventory-read-server"
import type { InventoryReadProof } from "../tests/fixtures/inventory-read-browser"

declare global { interface Window { inventoryReadProof: InventoryReadProof } }
// Actual browser fetch/JSON/IDB, actual handler/auth/reader with synthetic Supabase transport.
// No production route, hosted request/write or enabled UI. The SW proof uses its own loopback server.
async function main() {
  const dir = await mkdtemp(join(tmpdir(), "holofolder-inventory-read-"))
  let browser
  try {
    const output = join(dir, "proof.js")
    const build = spawnSync("bun", ["build", "tests/fixtures/inventory-read-browser.ts", "--target=browser", `--outfile=${output}`], { encoding: "utf8" })
    assert.equal(build.status, 0, build.stderr)
    const bundle = await readFile(output, "utf8")
    assert.doesNotMatch(bundle, /SUPABASE_SERVICE_ROLE_KEY|lib\/server\//)
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
    for (const scenario of ["cached", "inflight", "swap", "offline"]) {
      const f = fixture(1031)
      f.tables.storage_collection_state[0].kind = "custom"
      f.tables.storage_collection_state[0].default_presentation = "list"
      f.tables.storage_collection_state[0].location = "Synthetic private shelf"
      f.tables.inventory_items[0].legacy_source = { original: "Synthetic immutable source" }
      f.tables.binders[0].binder_rows = 2
      f.tables.binders[0].binder_cols = 4
      const context = await browser.newContext({ serviceWorkers: "block" })
      let hold = false, release: (() => void) | undefined, started: (() => void) | undefined
      let cached: { body: string; headers: Record<string, string>; status: number } | undefined
      let serveCached = false
      await context.route("https://synthetic-inventory.test/**", async route => {
        if (!route.request().url().includes("/api/inventory")) {
          await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic private read proof</title>" }); return
        }
        const response = await handleInventoryCompleteRead(new Request(route.request().url()), f.client)
        const result = { body: await response.text(), headers: Object.fromEntries(response.headers), status: response.status }
        cached ??= result
        if (hold) { started?.(); await new Promise<void>(resolve => { release = resolve }) }
        await route.fulfill(serveCached ? cached : result)
      })
      const page = await context.newPage()
      await page.goto("https://synthetic-inventory.test/app")
      await page.addScriptTag({ content: bundle })
      assert.deepEqual(await page.evaluate(() => window.inventoryReadProof.seed()), { count: 1031, branded: true, jsonBranded: false })
      const navigation = await page.evaluate(() => window.inventoryReadProof.navigation())
      assert.equal(navigation.indexKind, "complete")
      assert.equal(navigation.privateLocation, "Synthetic private shelf")
      assert.deepEqual(navigation.source, { original: "Synthetic immutable source" })
      assert.equal(navigation.location.kind, "assigned")
      if (navigation.location.kind === "assigned") {
        assert.equal(navigation.location.page, 129)
        assert.equal(navigation.location.intent.slotId, "synthetic-01030")
      }
      const partner = "33333333-3333-4333-8333-333333333333"
      f.setActor(partner)
      f.tables.partnerships = [{ id: collection, owner_user_id: owner, user1_id: owner, user2_id: partner }]
      f.tables.binders[0].binder_cols = null
      f.tables.user_settings = [{ user_id: owner, binder_rows: 3, binder_cols: 5, updated_at: "synthetic-grid-1" },
        { user_id: partner, binder_rows: 8, binder_cols: 8, updated_at: "synthetic-partner-grid" }]
      await page.evaluate(() => window.inventoryReadProof.partner())
      const partnerNavigation = await page.evaluate(() => window.inventoryReadProof.navigation())
      assert.equal(partnerNavigation.scope.accountUserId, partner)
      assert.equal(partnerNavigation.scope.ownerUserId, owner)
      assert.equal(partnerNavigation.indexKind, "complete")
      assert.equal(partnerNavigation.location.kind, "assigned")
      if (partnerNavigation.location.kind === "assigned") {
        assert.equal(partnerNavigation.location.page, 104, "2-row binder override inherits the owner's 5 columns")
        assert.equal(partnerNavigation.location.intent.slotId, "synthetic-01030")
      }
      for (const change of ["grid", "membership"]) {
        let changes = 0
        f.intercept(table => {
          if (table !== "tcg_cards") return
          if (change === "grid") f.tables.user_settings[0].updated_at = `synthetic-concurrent-grid-${++changes}`
          else { f.tables.partnerships[0].user1_id = partner; f.tables.partnerships[0].user2_id = owner }
        })
        assert.equal(await page.evaluate(async () => {
          try { await window.inventoryReadProof.navigation(); return "unexpected complete" }
          catch (error) { return (error as { code: string }).code }
        }), "inventory_read_conflict")
        f.intercept(undefined)
      }
      await page.evaluate(() => window.inventoryReadProof.enqueue())
      // Synthetic backend commit represented by actual table rows/revisions, not a complete JSON cast.
      f.tables.inventory_owner_state[0].inventory_revision = 8
      f.tables.storage_collection_state[0].version = 4
      f.tables.storage_collection_state[0].layout_revision = 5
      f.tables.binder_slots.push({ id: "synthetic-transport-slot", owner_user_id: owner, collection_id: collection, position: 9999,
        target: null, status: null, wanted_cards: [], preset_origin: null, version: 0 })
      if (scenario === "cached") {
        await page.evaluate(() => window.inventoryReadProof.startRead())
        assert.equal(await page.evaluate(() => window.inventoryReadProof.settleRead()), "complete")
        assert.equal((await page.evaluate(() => window.inventoryReadProof.replay("retained", 0))).pending.length, 1)
        // An old authenticated HTTP body cannot impersonate the next invocation either.
        serveCached = true
        assert.equal((await page.evaluate(() => window.inventoryReadProof.replay("fresh", 400000))).pending.length, 1)
        serveCached = false
      } else if (scenario === "inflight" || scenario === "swap") {
        hold = true
        const began = new Promise<void>(resolve => { started = resolve })
        await page.evaluate(() => window.inventoryReadProof.startRead())
        await began
        if (scenario === "swap") await page.evaluate(() => window.inventoryReadProof.switchSession())
        const replay = page.evaluate(() => window.inventoryReadProof.replay("retained", 0))
        // Ensure the queue is actually awaiting its post-reply read before delivering old HTTP.
        await page.waitForFunction(async () => (await window.inventoryReadProof.state()).pending[0]?.status === "sending")
        release!(); hold = false
        assert.equal((await replay).pending.length, 1)
        assert.equal(await page.evaluate(() => window.inventoryReadProof.settleRead()), scenario === "swap" ? "conflict" : "complete")
      } else {
        await context.unrouteAll({ behavior: "wait" })
        await context.route("**/*", route => route.abort("internetdisconnected"))
        await context.setOffline(true)
        assert.equal((await page.evaluate(() => window.inventoryReadProof.replay("fresh", 0))).pending.length, 1)
        assert.equal((await page.evaluate(() => window.inventoryReadProof.state())).snapshot?.items.length, 1031)
        // IDB survives reopening this origin without obtaining a new complete brand.
        await context.setOffline(false)
        await context.unrouteAll({ behavior: "wait" })
        await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic offline retained state</title>" }))
        await page.reload(); await page.addScriptTag({ content: bundle })
        assert.equal((await page.evaluate(() => window.inventoryReadProof.state())).pending.length, 1)
      }
      if (scenario === "cached" || scenario === "inflight") {
        assert.equal((await page.evaluate(() => window.inventoryReadProof.replay("fresh", 800000))).pending.length, 0)
        assert.equal((await page.evaluate(() => window.inventoryReadProof.state())).receipts[0].outcome, "acknowledged")
      }
      console.log(`PASS ${scenario}: real browser fetch/JSON/IDB, synthetic authenticated server fences, queue retention`)
      await context.close()
    }
    // Exercise the actual worker on a secure loopback origin, without Next dev or app auth.
    const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8")
    let privateRequests = 0
    const server = createServer((request, response) => {
      if (request.url === "/sw.js") {
        response.setHeader("Content-Type", "text/javascript")
        response.end(workerSource + `
        self.addEventListener("message", event => {
          if (event.data?.type === "SYNTHETIC_PRIVATE_WARM_PROOF") event.waitUntil(
            warmCacheUrls(event.data.urls).then(() => event.ports[0].postMessage("done")))
        })`)
      } else if (request.url?.includes("/api/inventory") || request.url?.includes("/api/binder-slots")) {
        privateRequests++
        response.setHeader("Content-Type", "application/json")
        response.setHeader("Cache-Control", "private, no-store")
        response.end(JSON.stringify({ syntheticNetworkRead: true }))
      } else {
        response.setHeader("Content-Type", "text/html")
        response.end("<!doctype html><title>Synthetic service worker privacy proof</title>")
      }
    })
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    try {
      const context = await browser.newContext({ serviceWorkers: "allow" })
      const page = await context.newPage()
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/proof`)
      await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js")
        await navigator.serviceWorker.ready
        if (!navigator.serviceWorker.controller) await new Promise<void>(resolve => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true }))
        // Deliberately seeded stale private body must never become a network fallback.
        const cache = await caches.open("binderdex-v3-images")
        await cache.put("/app/api/inventory", Response.json({ syntheticStaleSubset: true }))
      })
      assert.deepEqual(await page.evaluate(async () => (await fetch("/app/api/inventory")).json()), { syntheticNetworkRead: true })
      const beforeWarm = privateRequests
      await page.evaluate(async () => {
        const channel = new MessageChannel()
        const done = new Promise(resolve => { channel.port1.onmessage = resolve })
        navigator.serviceWorker.controller!.postMessage({ type: "SYNTHETIC_PRIVATE_WARM_PROOF", urls: ["/app/api/inventory/private.png", "/app/api/binder-slots/private.png"] }, [channel.port2])
        await done
      })
      assert.equal(privateRequests, beforeWarm)
      await context.setOffline(true)
      assert.equal(await page.evaluate(async () => { try { await fetch("/app/api/inventory"); return "unexpected cached reply" } catch { return "offline failure" } }), "offline failure")
      await context.close()
      console.log("PASS real service worker: private reads use network, warm-ups skipped, stale cached subset cannot mask offline failure")
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
  } finally { await browser?.close(); await rm(dir, { recursive: true, force: true }) }
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
