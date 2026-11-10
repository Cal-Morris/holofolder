import { readFileSync } from "node:fs"
import { sourceDigest } from "../lib/collection/legacy-source"
import { test, expect } from "./fixtures"

const queueKey = "pokemon_collection_pending_ops_v1"
const actor = "00000000-0000-4000-8000-0000000000e2"
const binder = "e2e00000-0000-4000-8000-000000000001"
const second = "e2e00000-0000-4000-8000-000000000002"
const recipient = { kind: "account", actorUserId: actor, ownerUserId: actor, binderId: binder }
// Synthetic records, including an unknown future protocol, duplicate IDs and wanted printings.
const item = { id: "synthetic", pokemon_id: 25, pokemon_name: "Synthetic Pikachu", card_id: "synthetic-card", card_name: "Synthetic reviewed card", status: "collected", wanted_cards: [], collected_at: "2026-11-10", card_language: "en", card_finish: "normal" }
const record = { id: "historical-id", type: "upsert", pokemonId: 25, item, base: null, queuedAt: "original-time" }

async function seed(page: import("@playwright/test").Page, raw: string) {
  await page.addInitScript(({ queueKey, raw }) => {
    if (!sessionStorage.getItem("legacy-seeded")) { localStorage.setItem(queueKey, raw); sessionStorage.setItem("legacy-seeded", "yes") }
  }, { queueKey, raw })
  await page.goto(`/app/e2e-harness?signedIn=1&binders=1&durableQueue=1`)
}

test.describe("durable device review", () => {
  test.use({ signedIn: true })
  for (const source of ["historical", "guest"]) test(`${source} needs explicit binder and acceptance, preserves exact data and uses a new bound action`, async ({ harness }) => {
    const { page } = harness
    const raw = `\n [\n ${JSON.stringify({ ...record, ...(source === "guest" ? { intentProtocol: 1, origin: { kind: "guest", workspaceId: "synthetic-workspace", localBinderId: "guest-default" } } : {}) }, null, 2)}\n ] \n`
    const writes: Record<string, unknown>[] = []
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }, { id: second, name: "Trades" }], ...(selected ? { collection: [] } : {}) } })
    })
    await page.route("**/app/api/collection", async route => {
      expect(route.request().headers()["x-holo-legacy-queue"]).toBe("2")
      const body = route.request().postDataJSON(); writes.push(body)
      return route.fulfill({ json: { item: { ...item, id: "saved-synthetic" } } })
    })
    await seed(page, raw)
    await expect(page.getByRole("region", { name: "Device changes" })).toBeVisible()
    await page.getByRole("button", { name: "Keep on this device", exact: true }).click()
    expect(writes).toHaveLength(0)
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await expect(dialog.getByRole("combobox", { name: "Destination binder" })).toHaveValue("")
    await expect(dialog.getByText(source === "guest" ? /Guest workspace/ : /Older changes, original account unknown/)).toBeVisible()
    await expect(dialog.getByRole("checkbox")).toBeDisabled()
    const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByRole("button", { name: "Download original data" }).click()])
    expect(readFileSync((await download.path())!, "utf8")).toBe(raw)
    await dialog.getByRole("combobox").selectOption(second)
    await expect(dialog.getByRole("checkbox")).toBeEnabled()
    await dialog.getByRole("checkbox").check()
    const add = dialog.getByRole("button", { name: "Add 1 reviewed changes to Trades" })
    await harness.expectMinTapTarget(add, 36)
    await harness.expectWithinSafeViewport(add)
    await harness.expectNoHorizontalOverflow()
    expect(writes).toHaveLength(0)
    await add.click()
    await expect.poll(() => writes.length).toBe(1)
    expect(writes[0].recipient).toEqual({ ...recipient, binderId: second })
    expect(writes[0].operationId).not.toBe(record.id)
    expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(raw)
    await expect(dialog.getByText(/Original data is retained/)).toBeVisible()
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.reload()
    expect(writes).toHaveLength(1)
  })

})

test.describe("durable hook offline writes", () => {
  test.use({ signedIn: true })
  test("offline edit survives reload and old [] without any old queue writer, unknown freezes its successor", async ({ harness }) => {
    const { page } = harness
    const writes: Record<string, unknown>[] = []
    await page.route("**/app/api/collection", route => {
      writes.push(route.request().postDataJSON())
      return route.fulfill({ status: 503, json: { error: "synthetic unknown outcome" } })
    })
    await page.goto('/app/e2e-harness?signedIn=1&binders=1&durableQueue=1')
    // navigator.onLine controls the actual hook; documents remain available for reload in this synthetic test.
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); dispatchEvent(new Event('offline')) })
    const open = async () => {
      await page.locator('button[data-dex-id="4"]').first().click()
      const detail = page.getByRole('dialog', { name: /details$/i })
      await detail.locator('summary').filter({ hasText: 'Card & variant' }).click()
      return detail
    }
    let detail = await open()
    await detail.getByRole('button', { name: 'Holo', exact: true }).click()
    await expect(detail.getByRole('button', { name: 'Holo', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(writes).toHaveLength(0)
    expect(await page.evaluate(() => localStorage.getItem('pokemon_collection_pending_ops_v1'))).toBeNull()
    await page.keyboard.press('Escape')
    await page.evaluate(() => localStorage.setItem('pokemon_collection_pending_ops_v1', '[]'))
    await page.reload()
    await expect.poll(() => writes.length).toBe(1)
    detail = await open()
    await expect(detail.getByRole('button', { name: 'Holo', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await detail.getByRole('button', { name: 'Normal', exact: true }).click()
    await page.evaluate(() => { dispatchEvent(new Event('online')); dispatchEvent(new Event('focus')) })
    await expect(detail.getByRole('button', { name: 'Normal', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(writes).toHaveLength(1)
    expect(await page.evaluate(() => localStorage.getItem('pokemon_collection_pending_ops_v1'))).toBe('[]')
    await harness.expectNoHorizontalOverflow()
  })
})

test.describe("durable acceptance cancellation", () => {
  test.use({ signedIn: true })
  test("cancel cannot miss an acceptance transaction, including after closing review", async ({ harness }) => {
    const { page } = harness
    await page.addInitScript(() => {
      const state = globalThis as unknown as { holdAcceptance: boolean; acceptanceHeld?: boolean }
      state.holdAcceptance = true
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function(value, key) {
        const request = put.call(this, value, key), get = this.get.bind(this)
        if (key === "legacy-collection-queue:v2" && value.entries?.some((entry: { state: string; operation: { recoverySource?: unknown } }) => entry.state === "ready" && entry.operation.recoverySource)) {
          request.addEventListener("success", () => {
            if (!state.holdAcceptance) return
            state.acceptanceHeld = true
            const keepAlive = () => { get(key).addEventListener("success", () => { if (state.holdAcceptance) keepAlive() }) }
            keepAlive()
          }, { once: true })
        }
        return request
      }
    })
    let writes = 0
    await page.route("**/app/api/collection", route => { writes++; return route.fulfill({ json: { item } }) })
    await page.route("**/app/api/collection/review-destination**", route => {
      const selected = new URL(route.request().url()).searchParams.get("binderId")
      return route.fulfill({ json: { recipient: { ...recipient, binderId: selected }, memberIds: [actor], binders: [{ id: binder, name: "My binder" }], ...(selected ? { collection: [] } : {}) } })
    })
    await seed(page, JSON.stringify([record]))
    await page.evaluate(() => { Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false }); dispatchEvent(new Event("offline")) })
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Review device changes" })
    await dialog.getByRole("combobox").selectOption(binder)
    await dialog.getByRole("checkbox").check()
    await dialog.getByRole("button", { name: "Add 1 reviewed changes to My binder" }).click()
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { acceptanceHeld?: boolean }).acceptanceHeld)).toBe(true)
    await expect(dialog.getByRole("button", { name: "Cancel upload", exact: true })).toBeDisabled()
    await dialog.getByRole("button", { name: "Cancel upload", exact: true }).evaluate(button => (button as HTMLButtonElement).click())
    await expect(dialog.getByText(/Upload stopped/)).toHaveCount(0)
    await dialog.getByRole("button", { name: "Close device changes" }).click()
    await page.evaluate(() => { (globalThis as unknown as { holdAcceptance: boolean }).holdAcceptance = false })
    await page.getByRole("button", { name: "Review changes", exact: true }).click()
    await expect(dialog.getByRole("button", { name: "Cancel upload", exact: true })).toBeEnabled()
    await dialog.getByRole("button", { name: "Cancel upload", exact: true }).click()
    await expect(dialog.getByText(/Upload stopped/)).toBeVisible()
    const states = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("binderdex-offline"); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      return await new Promise<string[]>((resolve, reject) => { const request = db.transaction("records").objectStore("records").get("legacy-collection-queue:v2"); request.onsuccess = () => { db.close(); resolve(request.result.entries.filter((entry: { operation: { recoverySource?: unknown } }) => entry.operation.recoverySource).map((entry: { state: string }) => entry.state)) }; request.onerror = () => reject(request.error) })
    })
    expect(states).toEqual(["paused"])
    expect(writes).toBe(0)
  })
})

test.describe("durable host storage failure and privacy", () => {
  test.use({ signedIn: true })
  for (const fault of ["abort", "quota"]) test(`${fault} prevents optimistic save and transport, retains an explicit retry draft`, async ({ harness }) => {
    const { page } = harness
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function(value, key) {
        const state = globalThis as unknown as { syntheticQueueFault?: string }
        if (key === "legacy-collection-queue:v2" && state.syntheticQueueFault && value.entries?.some((entry: { state: string }) => entry.state === "ready")) {
          const fault = state.syntheticQueueFault; state.syntheticQueueFault = undefined
          if (fault === "quota") throw new DOMException("Synthetic quota failure", "QuotaExceededError")
          const request = put.call(this, value, key), transaction = this.transaction
          request.addEventListener("success", () => transaction.abort(), { once: true })
          return request
        }
        return put.call(this, value, key)
      }
    })
    let sends = 0
    await page.route("**/app/api/collection", route => { sends++; return route.fulfill({ json: { item: { ...item, pokemon_id: 4, pokemon_name: "charmander" } } }) })
    await page.goto('/app/e2e-harness?signedIn=1&binders=1&durableQueue=1')
    // Opening the detail waits for the host to finish hydrating before injecting the write failure.
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole('dialog', { name: /details$/i })
    await detail.locator('summary').filter({ hasText: 'Card & variant' }).click()
    await expect(detail.getByRole('button', { name: 'Holo', exact: true })).toBeEnabled()
    await page.evaluate(fault => Object.assign(globalThis, { syntheticQueueFault: fault }), fault)
    await detail.getByRole('button', { name: 'Holo', exact: true }).click()
    await expect(page.getByText(/This draft is unsaved/)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Normal', exact: true })).toHaveAttribute('aria-pressed', 'true')
    expect(sends).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('pokemon_collection_pending_ops_v1'))).toBeNull()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Retry draft', exact: true }).click()
    await expect.poll(() => sends).toBe(1)
  })
  test("foreign originals stay private and retained, compatibility still blocks review", async ({ harness }) => {
    const { page } = harness
    const privateRecord = { ...record, intentProtocol: 1, origin: { ...recipient, actorUserId: "foreign", ownerUserId: "foreign" }, binderId: binder, item: { ...item, card_name: "PRIVATE_FOREIGN_MARKER" } }
    const raw = JSON.stringify([privateRecord, record])
    await seed(page, raw)
    await expect(page.getByText('PRIVATE_FOREIGN_MARKER', { exact: false })).toHaveCount(0)
    expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(raw)
    const paused = { ...record, intentProtocol: 1, origin: recipient, binderId: binder, compatibilityPause: { code: 'binder_converted_requires_slot_commands', rawRecord: JSON.stringify(record) } }
    const secondSource = JSON.stringify([paused, { ...record, id: 'review-other', pokemonId: 26, item: { ...item, pokemon_id: 26 } }])
    await page.evaluate(({ queueKey, secondSource }) => { localStorage.setItem(queueKey, secondSource); dispatchEvent(new Event('focus')) }, { queueKey, secondSource })
    await expect(page.getByRole('region', { name: 'Device changes' })).toBeVisible()
    await page.route('**/app/api/collection/review-destination**', route => route.fulfill({ json: { recipient, memberIds: [actor], binders: [{ id: binder, name: 'My binder' }], collection: [] } }))
    await page.getByRole('button', { name: 'Review changes', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review device changes' })
    await review.getByRole('combobox').selectOption(binder)
    await expect(review.getByText(/This converted-binder pause needs a compatible client/)).toBeVisible()
    await expect(review.getByRole('checkbox')).toHaveCount(0)
    await harness.expectNoHorizontalOverflow()
    await harness.expectMinTapTarget(review.getByRole('button', { name: 'Close device changes' }), 36)
    await harness.tapBackdrop(review)
    await expect(review).toHaveCount(0)
    await page.getByRole('button', { name: 'Review changes', exact: true }).click()
    await page.keyboard.press('Escape')
    await expect(review).toHaveCount(0)
  })
})

async function changeAccount(page: import("@playwright/test").Page, userId = "00000000-0000-4000-8000-0000000000b2") {
  await page.evaluate(userId => {
    const name = document.cookie.split(";").map(value => value.trim().split("=")[0]).find(name => /^sb-.*-auth-token$/.test(name))!
    const encoded = document.cookie.split(";").map(value => value.trim()).find(value => value.startsWith(name + "="))!.slice(name.length + 1)
    const decode = (value: string) => JSON.parse(atob(value.replace(/-/g, "+").replace(/_/g, "/")))
    const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    const session = decode(encoded.slice("base64-".length))
    session.user = { ...session.user, id: userId }
    const token = session.access_token.split(".")
    token[1] = encode({ ...decode(token[1]), sub: session.user.id })
    session.access_token = token.join(".")
    document.cookie = `${name}=base64-${encode(session)}; path=/; SameSite=Lax`
    const channel = new BroadcastChannel(name)
    channel.postMessage({ event: "SIGNED_IN", session: { ...session, user: { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic-b@example.test", app_metadata: {}, user_metadata: {} } } })
    channel.close()
  }, userId)
}

test.describe("durable claimed sender lifecycle", () => {
  test.use({ signedIn: true })
  for (const returnToA of [false, true]) test(`late claimed ACK is inert after A to B${returnToA ? " to A" : ""}`, async ({ harness }) => {
    const { page } = harness
    await page.goto("/app/e2e-harness?signedIn=1&binders=1&durableQueue=1")
    let release!: () => void, calls = 0
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route("**/app/api/collection", async route => {
      calls++; await held
      await route.fulfill({ json: { item: { ...item, pokemon_id: 4, card_finish: "holo" } } })
    })
    const saved = () => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve,reject) => { const request=indexedDB.open("binderdex-offline");request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error) })
      return await new Promise<{ entries: { operation: { id: string }; state: string; request: unknown }[] }>((resolve,reject)=>{const request=db.transaction("records").objectStore("records").get("legacy-collection-queue:v2");request.onsuccess=()=>{db.close();resolve(request.result)};request.onerror=()=>reject(request.error)})
    })
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect.poll(() => calls).toBe(1)
    const before = (await saved()).entries[0]
    await changeAccount(page)
    await page.keyboard.press("Escape")
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_snapshot_v1") ?? "{}").ownerUserId)).toBe("00000000-0000-4000-8000-0000000000b2")
    if (returnToA) {
      await changeAccount(page, actor)
      await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("pokemon_collection_snapshot_v1") ?? "{}").ownerUserId)).toBe(actor)
    }
    release()
    await page.evaluate(() => dispatchEvent(new Event("focus")))
    await expect.poll(async () => (await saved()).entries[0].state).toBe("sending")
    expect((await saved()).entries[0].request).toEqual(before.request)
    expect((await saved()).entries[0].operation.id).toBe(before.operation.id)
    expect(calls).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1"))).toBeNull()
  })
})

test("nested source evidence remains downloadable without flattening or replay", async ({ harness }) => {
  const { page } = harness
  const nested = JSON.stringify([record])
  const raw = JSON.stringify([{ legacyQueueSource: { version: 1, raw: nested, digest: sourceDigest(nested), accepted: [0] } }])
  await seed(page, raw)
  await page.getByRole('button', { name: 'Review changes', exact: true }).click()
  const review = page.getByRole('dialog', { name: 'Review device changes' })
  await expect(review.getByRole('checkbox')).toHaveCount(0)
  const [download] = await Promise.all([page.waitForEvent('download'), review.getByRole('button', { name: 'Download original data' }).click()])
  expect(readFileSync((await download.path())!, 'utf8')).toBe(raw)
  expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(raw)
})

test.describe("durable reviewed deletion", () => {
  test.use({ signedIn: true })
  test("historical removal uses a claimed DELETE with its reviewed base", async ({ harness }) => {
    const { page } = harness
    const raw = JSON.stringify([{ id: "synthetic-historical-delete", type: "delete", pokemonId: 25, base: null, queuedAt: "synthetic" }])
    let writes = 0
    await page.route('**/app/api/collection/review-destination**', route => route.fulfill({ json: { recipient, memberIds: [actor], binders: [{ id: binder, name: 'My binder' }], collection: [] } }))
    await page.route('**/app/api/collection?**', route => {
      const url = new URL(route.request().url())
      expect(route.request().method()).toBe('DELETE')
      expect(url.searchParams.get('binderId')).toBe(binder)
      expect(url.searchParams.get('operationId')).not.toBe('synthetic-historical-delete')
      expect(url.searchParams.has('baseFingerprint')).toBe(true)
      writes++; return route.fulfill({ json: { success: true } })
    })
    await seed(page, raw)
    await page.getByRole('button', { name: 'Review changes', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review device changes' })
    await review.getByRole('combobox').selectOption(binder)
    await review.getByRole('checkbox').check()
    await review.getByRole('button', { name: 'Add 1 reviewed changes to My binder' }).click()
    await expect.poll(() => writes).toBe(1)
    expect(await page.evaluate(queueKey => localStorage.getItem(queueKey), queueKey)).toBe(raw)
  })
})

test.describe("prepared queue protocol rejection", () => {
  test.use({ signedIn: true })
  test("the agreed upgrade rejection pauses the frozen request without ACK or replay", async ({ harness }) => {
    const { page } = harness
    let sends = 0
    await page.route("**/app/api/collection", route => {
      expect(route.request().headers()["x-holo-legacy-queue"]).toBe("2")
      sends++; return route.fulfill({ status: 503, json: { code: "collection_queue_upgrade_required", retainOnDevice: true } })
    })
    await page.goto("/app/e2e-harness?signedIn=1&binders=1&durableQueue=1")
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect.poll(() => sends).toBe(1)
    await expect(detail.getByRole("button", { name: "Holo", exact: true })).toHaveAttribute("aria-pressed", "true")
    await page.keyboard.press("Escape")
    await page.evaluate(() => { dispatchEvent(new Event("online")); dispatchEvent(new Event("focus")) })
    await page.reload()
    await expect(page.getByRole("region", { name: "Device changes" })).toBeVisible()
    expect(sends).toBe(1)
    expect(await page.evaluate(() => localStorage.getItem("pokemon_collection_pending_ops_v1"))).toBeNull()
  })
})
