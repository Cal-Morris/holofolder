import { test, expect, SEEDED_COLLECTION } from "./fixtures"

const key = "pokemon_collection_pending_ops_v1"
const code = "binder_converted_requires_slot_commands"
const binder = "e2e00000-0000-4000-8000-000000000001"
const origin = { kind: "account", actorUserId: "00000000-0000-4000-8000-0000000000e2", ownerUserId: "00000000-0000-4000-8000-0000000000e2", binderId: binder }

for (const type of ["delete", "upsert", "import"] as const) for (const withBase of [false, true]) {
  test.describe(`${type} base=${withBase}`, () => {
    test.use({ signedIn: true })
    test("retains unbound historical intent through reload without sending or normalizing it", async ({ harness }) => {
      const { page } = harness
      let requests = 0
      await page.route("**/app/api/collection**", route => {
        requests++
        return route.fulfill({ status: 409, json: { error: "This binder uses stable slots. Reload with a slot-compatible client before editing.", code, requiredCapability: "binder_slots_v1", slotOperationsEnabled: false } })
      })
      // Synthetic queued intent with historical fields, including a missing recipient binding.
      const item = SEEDED_COLLECTION[0]
      const record = { id: "synthetic-original-id", type: type === "delete" ? "delete" : "upsert", pokemonId: item.pokemon_id,
        ...(type !== "delete" ? { item, acquisition: { operationId: "original-operation", recipientId: "original-recipient" } } : {}),
        ...(type === "import" ? { importOnly: true } : {}), ...(withBase ? { base: item } : {}),
        queuedAt: "2026-11-10T00:00:00.000Z", binderId: null, historicalRecipient: "preserve-only" }
      const rawRecord = `\n${JSON.stringify(record, null, 2)}\n`
      // Seed before the next app instance starts, avoiding a write from the outgoing page.
      await page.addInitScript(({ key, value }) => {
        if (!sessionStorage.getItem("synthetic-queue-seeded")) {
          localStorage.setItem(key, value)
          sessionStorage.setItem("synthetic-queue-seeded", "1")
        }
      }, { key, value: `[${rawRecord}]` })
      await page.reload()
      const banner = page.getByRole("region", { name: "Device changes" })
      await expect(banner).toBeVisible()
      expect(requests).toBe(0)
      await harness.expectNoHorizontalOverflow()
      await page.reload()
      await expect(banner).toBeVisible()
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"))
        document.dispatchEvent(new Event("visibilitychange"))
      })
      expect(requests).toBe(0)
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(`[${rawRecord}]`)
    })
  })
}

test.describe("direct legacy write", () => {
  test.use({ signedIn: true })
  test("queues the first compatibility rejection without resending it", async ({ harness }) => {
    const { page } = harness
    let requests = 0
    await page.route("**/app/api/collection**", route => {
      requests++
      return route.fulfill({ status: 409, json: { error: "Needs compatible client", code } })
    })
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    await page.locator('button[data-dex-id="4"]').first().click()
    const detail = page.getByRole("dialog", { name: /details$/i })
    await detail.locator("summary").filter({ hasText: "Card & variant" }).click()
    await detail.getByRole("button", { name: "Holo", exact: true }).click()
    await expect(page.locator('[data-sync-status="compatibility"]')).toBeVisible()
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
    expect(saved).toHaveLength(1)
    expect(saved[0].compatibilityPause.code).toBe(code)
    expect(saved[0].item.card_finish).toBe("holo")
    await page.keyboard.press("Escape")
    await page.reload()
    await expect(page.locator('[data-sync-status="compatibility"]')).toBeVisible()
    expect(requests).toBe(1)
  })
})

test.describe("pending legacy response", () => {
  test.use({ signedIn: true })
  test("keeps the rejected original and a newer queued edit without replaying either", async ({ harness }) => {
    const { page } = harness
    let requests = 0
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await page.route("**/app/api/collection**", async route => {
      requests++
      await held
      await route.fulfill({ status: 409, json: { error: "Needs compatible client", code } })
    })
    const { user_id: _userId, ...base } = SEEDED_COLLECTION[0]
    const original = { id: "original", type: "delete", pokemonId: 1, base, binderId: binder, origin, intentProtocol: 1, queuedAt: "original-time" }
    const rawRecord = JSON.stringify(original, null, 2)
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key, value: `[${rawRecord}]` })
    await page.goto("/app/e2e-harness?signedIn=1&binders=1")
    await expect.poll(() => requests).toBe(1)
    const newer = { ...original, id: "newer", queuedAt: "later-time", base: null }
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: JSON.stringify([newer]) })
    release()
    await expect(page.locator('[data-sync-status="compatibility"]')).toBeVisible()
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)!).filter((op: { compatibilityPause?: unknown }) => op.compatibilityPause).length, key)).toBe(2)
    const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), key)
    expect(saved).toHaveLength(2)
    for (const [index, record] of [original, newer].entries()) {
      const { compatibilityPause, ...retained } = saved[index]
      expect(retained).toEqual(record)
      expect(compatibilityPause.code).toBe(code)
    }
    expect(saved[0].compatibilityPause.rawRecord).toBe(rawRecord)
    expect(requests).toBe(1)
  })
})
