import type { BrowserContext, Page } from "@playwright/test"
import { expect, MOCK_CARDS, placeholderSvg, SEEDED_COLLECTION, SUPABASE_URL, test } from "./fixtures"

const BASE_SET = { id: "base1", name: "Base Set", seriesName: "Base", officialCardCount: 102, releaseDate: "1999-01-09" }
const SV151 = { id: "sv03.5", name: "151", seriesName: "Scarlet & Violet", officialCardCount: 165, releaseDate: "2023-09-22" }
// Synthetic test set (not a real TCG set) whose Pokémon are not on the first binder page, so nothing of it is
// cached before the prep.
const SHOW_SET = { id: "show1", name: "Legends Showcase", seriesName: "Test", officialCardCount: 3, releaseDate: "2026-09-01" }
const SHOW_CARDS = [
  { dexId: 150, name: "Mewtwo", localId: "001" },
  { dexId: 151, name: "Mew", localId: "002" },
  { dexId: 249, name: "Lugia", localId: "003" },
].map(({ dexId, name, localId }) => ({
  id: `show1-${localId}`,
  localId,
  name,
  image: `https://assets.tcgdex.net/en/mock/show1/${localId}/high.webp`,
  set: SHOW_SET,
  rarity: "Rare",
  language: "en",
  inferredFinish: "holo",
  dexIds: [dexId],
}))
const ALL_SETS = [BASE_SET, SV151, SHOW_SET]

function slotsFor(setId: string) {
  if (setId === SHOW_SET.id) {
    return SHOW_CARDS.map(({ dexIds, ...card }) => ({ dexId: dexIds[0], pokemonName: card.name, cards: [card] }))
  }
  const bySlot = new Map<number, { dexId: number; pokemonName: string; cards: unknown[] }>()
  for (const card of MOCK_CARDS.filter((entry) => entry.set.id === setId)) {
    const dexId = card.dexIds[0]
    const slot = bySlot.get(dexId) ?? { dexId, pokemonName: card.name, cards: [] }
    slot.cards.push({ ...card, dexIds: undefined, language: "en", inferredFinish: "normal" })
    bySlot.set(dexId, slot)
  }
  return [...bySlot.values()]
}

/**
 * Backends at the context level, so requests the service worker makes are mocked too. `network.offline`
 * makes every mocked network request fail, like a phone with no signal (cached copies still work).
 */
async function mockNetwork(context: BrowserContext, page: Page) {
  const network = { offline: false, proxyImages: [] as string[] }
  const guard = <T,>(handler: (route: import("@playwright/test").Route) => T) => (route: import("@playwright/test").Route) =>
    network.offline ? route.abort("internetdisconnected") : handler(route)

  await context.route("**/api/tcg-set-slots**", guard((route) => {
    const url = new URL(route.request().url())
    const setId = url.searchParams.get("setId")
    const query = (url.searchParams.get("query") ?? "").toLowerCase()
    if (url.searchParams.get("recent") === "1") return route.fulfill({ json: { sets: ALL_SETS, selectedSet: null, slots: [] } })
    if (setId) {
      const set = ALL_SETS.find((entry) => entry.id === setId) ?? null
      return route.fulfill({ json: { sets: set ? [set] : [], selectedSet: set, slots: set ? slotsFor(set.id) : [] } })
    }
    return route.fulfill({ json: { sets: ALL_SETS.filter((set) => set.name.toLowerCase().includes(query)), selectedSet: null, slots: [] } })
  }))
  await context.route("**/api/card-image-proxy**", guard((route) => {
    const source = new URL(route.request().url()).searchParams.get("url") ?? ""
    // Since #48 the binder's Pokémon artwork goes through the proxy too; only card thumbnails count here.
    if (!source.includes("raw.githubusercontent.com")) network.proxyImages.push(source)
    return route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg("saved", network.proxyImages.length) })
  }))
  const rawImage = guard((route) => route.fulfill({ contentType: "image/svg+xml", body: placeholderSvg("card", 1) }))
  await context.route(/^https:\/\/assets\.tcgdex\.net\//, rawImage)
  // The shared fixture also answers these on the page; override so they fail offline too.
  await page.route(/^https:\/\/assets\.tcgdex\.net\//, rawImage)
  await context.route("**/api/tcgdex-cache**", guard((route) => {
    const pokemonId = Number(new URL(route.request().url()).searchParams.get("pokemonId"))
    return route.fulfill({ json: { cards: MOCK_CARDS.filter((card) => card.dexIds.includes(pokemonId)).map((card) => ({ ...card, dexIds: undefined })), source: "mirror" } })
  }))
  await context.route("**/api/tcg-card-search**", guard((route) => route.fulfill({ json: { cards: [] } })))
  await context.route("**/api/card-prices**", guard((route) => {
    const body = route.request().postDataJSON() ?? {}
    // Synthetic quotes verify explicit card-show downloads survive going offline.
    return route.fulfill({ json: { prices: (body.cards ?? []).map((card: { cardId: string; language: string }) => ({
      ...card, marketGbpAmount: 5, gbpAmount: 5, confidence: "medium", source: "tcgplayer", finishPrices: [],
      historyPoints: [{ date: "2026-09-15", source: "tcgplayer", currency: "USD", amount: 4, lowAmount: 2, finish: "normal", productId: "123" }],
    })) } })
  }))
  return network
}

async function goOffline(page: Page, network: { offline: boolean }) {
  network.offline = true
  await page.context().setOffline(true)
  const session = await page.context().newCDPSession(page)
  await session.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
}

test.describe("offline search and card show prep", () => {
  test.use({ signedIn: true, serviceWorkers: "allow" })

  test("prepare a set for a card show, then browse and search it offline", async ({ harness, context }) => {
    const { page } = harness
    const network = await mockNetwork(context, page)
    // Second load: the service worker now controls the page (as after a first visit).
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await expect(harness.dock()).toBeVisible()

    // Card scanning's text reader comes from jsDelivr. Stub it (never real network) and hide any system
    // text reader so prep has to fetch it, as on an iPhone.
    const ocrRequests: string[] = []
    await context.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js|@tesseract\.js-data)/, (route) => {
      ocrRequests.push(route.request().url())
      return route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: "/* stub tesseract worker */" })
    })
    await page.evaluate(() => { delete (window as { TextDetector?: unknown }).TextDetector })

    await harness.dock().getByRole("button", { name: "Browse", exact: true }).click()
    await page.getByText("Offline set tools", { exact: true }).click()
    const prep = page.getByRole("region", { name: "Prepare for card show" })
    await prep.getByRole("button", { name: "Prepare for card show" }).click()
    await prep.getByRole("checkbox", { name: /legends showcase/i }).check()

    // Size first: only the set data and a couple of sample thumbnails are fetched.
    await prep.getByRole("button", { name: "Check download size" }).click()
    await expect(prep.getByRole("status")).toHaveText(/1 set · 3 card images · about \d+ KB/)
    expect(network.proxyImages.length, "only the 3 samples before confirming").toBe(3)
    await prep.getByRole("button", { name: "Download for offline" }).click()
    await expect(prep.getByRole("status")).toHaveText("Download finished: Legends Showcase (3/3 card images, 3/3 cards priced)")
    await expect.poll(() => page.evaluate(() => new Promise<number>((resolve, reject) => {
      const request = indexedDB.open("binderdex-offline")
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const keys = db.transaction("records").objectStore("records").getAllKeys()
        keys.onsuccess = () => { resolve(keys.result.filter(key => String(key).startsWith("price-evidence:")).length); db.close() }
        keys.onerror = () => { reject(keys.error); db.close() }
      }
    }))).toBeGreaterThanOrEqual(3)
    await expect(prep.getByRole("region", { name: "Saved on this device" })).toContainText("Legends Showcase: set data saved, 3/3 images, 3/3 available prices.")
    // Prep also downloads the scan text reader, and the service worker keeps it for Scan offline.
    await expect.poll(() => ocrRequests.some((url) => url.includes("/npm/tesseract.js@")), { timeout: 15_000 }).toBe(true)
    await expect.poll(() => page.evaluate(async () => {
      const keys = await (await caches.open("binderdex-v1-ocr")).keys()
      return keys.some((request) => request.url.includes("/npm/tesseract.js@") && request.url.endsWith("/worker.min.js"))
    }), { timeout: 15_000 }).toBe(true)
    expect(network.proxyImages.every((url) => url.endsWith("/low.webp")), "thumbnails go through the proxy at low res").toBe(true)
    expect(new Set(network.proxyImages).size, "each thumbnail downloaded once").toBe(3)

    // The prepared thumbnails are also kept apart from the everyday image cache. Simulate that cache
    // evicting them (it drops its oldest entries past its cap): they still have to show offline.
    await expect.poll(() => page.evaluate(async () => {
      const keys = await (await caches.open("binderdex-v1-show-images")).keys()
      return keys.filter((request) => request.url.includes("show1")).length
    })).toBe(3)
    expect(await page.evaluate(async () => {
      const images = await caches.open("binderdex-v3-images")
      const prepared = (await images.keys()).filter((request) => request.url.includes("show1"))
      await Promise.all(prepared.map((request) => images.delete(request)))
      return prepared.length
    }), "the everyday image cache had them too").toBe(3)

    await goOffline(page, network)

    // Sets view offline: find the saved set by name and open it with its card thumbnails.
    const search = page.getByRole("textbox", { name: "Search sets by name or code" })
    await search.fill("legends")
    await expect(page.getByText("Showing saved set data on this device.")).toBeVisible()
    await page.getByRole("button", { name: /^Legends Showcase/ }).first().click()
    await expect(page.getByRole("button", { name: "Select Mewtwo", exact: true })).toBeVisible()
    const thumbnail = page.locator('img[alt="Mewtwo"]').first()
    await expect(thumbnail).toHaveAttribute("data-saved-thumbnail", "1")
    await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true)

    // Global search offline: own cards and saved sets.
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: /search pokemon/i })
    await dialog.getByRole("textbox").fill("lugia")
    const cards = dialog.getByRole("region", { name: /card results/i })
    await expect(cards.getByText(/offline: your cards and saved sets/i)).toBeVisible()
    await expect(cards.getByRole("button", { name: /lugia 003\/3 legends showcase/i })).toBeVisible()
  })

  test("Show finder prepares offline without opening Sets, then inspects partial saved data offline", async ({ harness, context }, testInfo) => {
    const { page } = harness
    const network = await mockNetwork(context, page)
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    // Synthetic native OCR prevents any external OCR download in this focused test.
    await page.evaluate(() => { Object.defineProperty(window, "TextDetector", { configurable: true, value: class { detect() { return Promise.resolve([]) } } }) })
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    const entry = quick.getByRole("button", { name: "Prepare offline", exact: true })
    await harness.expectMinTapTarget(entry, 36)
    await entry.click()
    await expect(quick.getByRole("heading", { name: "Prepare offline", exact: true })).toBeVisible()
    await expect(quick.getByText("No saved set data found.")).toBeVisible()
    expect(network.proxyImages).toHaveLength(0)
    await harness.expectNoHorizontalOverflow()
    await harness.expectWithinSafeViewport(quick.getByRole("button", { name: "Close quick mode" }))
    await page.screenshot({ path: `/tmp/prepare-offline-${testInfo.project.name}.png` })
    await quick.getByRole("searchbox", { name: "Find sets to save" }).fill("Legends")
    await quick.getByRole("button", { name: "Find", exact: true }).click()
    await quick.getByRole("checkbox", { name: /Legends Showcase/ }).check()
    await quick.getByRole("button", { name: "Check download size" }).click()
    await expect(quick.getByRole("status")).toContainText("3 card images")
    // Price batches fail, then one image is evicted. Saved coverage and other images remain useful.
    await page.route("**/api/card-prices", route => route.fulfill({ status: 503, body: "synthetic unavailable" }))
    await quick.getByRole("button", { name: "Download for offline" }).click()
    await expect(quick.getByRole("status")).toContainText("Couldn't download prices (503)")
    await expect.poll(() => page.evaluate(async () => (await (await caches.open("binderdex-v1-show-images")).keys()).filter(request => request.url.includes("show1")).length)).toBe(3)
    await page.evaluate(async () => {
      for (const name of ["binderdex-v1-show-images", "binderdex-v3-images"]) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) if (request.url.includes("show1%2F001")) await cache.delete(request)
      }
    })
    await quick.getByRole("button", { name: "Close quick mode" }).click()
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match("/app-shell"))), { timeout: 30_000 }).toBe(true)
    await goOffline(page, network)
    await page.reload()
    await expect(harness.dock()).toBeVisible()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await quick.getByRole("button", { name: "Prepare offline", exact: true }).click()
    await expect(quick.getByRole("region", { name: "Saved on this device" })).toContainText("Legends Showcase: set data saved, 2/3 images, 0/3 available prices.")
    await expect(quick.getByText("You're offline. Connect to download sets.")).toBeVisible()
    await expect(quick.getByRole("button", { name: "Check download size" })).toBeDisabled()
    await expect(quick.getByRole("button", { name: "Find", exact: true })).toBeDisabled()
    await expect(quick.getByText(/Ready offline/)).toHaveCount(0)
    await page.screenshot({ path: `/tmp/prepare-offline-saved-${testInfo.project.name}.png` })
    await page.keyboard.press("Escape")
    await expect(quick).toBeHidden()
    await harness.expectScrollUnlocked()
  })

  test("wanted sets are offered directly and stopping a size check keeps the panel usable", async ({ harness, context }) => {
    const { page } = harness
    await mockNetwork(context, page)
    // Synthetic wanted printing uses a real candidate set, with no catalog request needed.
    await page.route(`${SUPABASE_URL}/rest/v1/pokemon_collection**`, route => route.fulfill({ json: [
      { ...SEEDED_COLLECTION[0], wanted_cards: [{ card_id: "base1-44", card_name: "Bulbasaur", card_set: "Base Set", added_at: "2026-01-01" }] },
    ] }))
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)
    await page.getByRole("button", { name: "Show mode", exact: true }).click()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const quick = page.getByRole("dialog", { name: "Quick mode" })
    await quick.getByRole("button", { name: "Prepare offline", exact: true }).click()
    await quick.getByRole("checkbox", { name: "Base Set", exact: true }).check()
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    await context.route("**/api/tcg-set-slots**", async route => { await pending; await route.abort().catch(() => undefined) })
    try {
      await quick.getByRole("button", { name: "Check download size" }).click()
      await expect(quick.getByRole("status")).toHaveText("Checking download size…")
      await quick.getByRole("button", { name: "Stop", exact: true }).click()
      await expect(quick.getByText("Stopped. Anything already saved stays on this device.")).toBeVisible()
      await expect(quick.getByRole("button", { name: "Check download size" })).toBeEnabled()
    } finally { release() }
    await page.goBack()
    await expect(quick).toBeHidden()
    await harness.expectScrollUnlocked()
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    await quick.getByRole("button", { name: "Prepare offline", exact: true }).click()
    const title = quick.getByRole("heading", { name: "Prepare offline", exact: true })
    const box = (await title.boundingBox())!
    await page.mouse.move(box.x + 10, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + 10, box.y + 220, { steps: 8 })
    await page.mouse.up()
    await expect(quick).toBeHidden()
  })

  test("offline search finds the user's own cards without any saved sets", async ({ harness, context }) => {
    const { page } = harness
    const network = await mockNetwork(context, page)
    // The search sheet is a lazy chunk (PERF-1): wait until the worker controls the page and has the offline
    // shell, which it only stores after the lazy chunks are cached.
    await expect.poll(() => page.evaluate(async () => Boolean(navigator.serviceWorker.controller) && Boolean(await caches.match("/app-shell"))), { timeout: 30_000 }).toBe(true)
    await goOffline(page, network)
    await harness.dock().getByRole("button", { name: "Search", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: /search pokemon/i })
    await dialog.getByRole("textbox").fill("bulbasaur")
    const cards = dialog.getByRole("region", { name: /card results/i })
    await expect(cards.getByText(/offline: your cards and saved sets/i)).toBeVisible()
    // The seeded collection owns Base Set Bulbasaur (base1-44).
    await expect(cards.getByRole("button", { name: /bulbasaur 44\/\d* ?base set|bulbasaur #?44 base set/i })).toBeVisible()
  })
})
