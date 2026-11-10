import { test, expect, SEEDED_COLLECTION } from "./fixtures"

const key = "pokemon_collection_pending_ops_v1"
const code = "binder_converted_requires_slot_commands"

for (const type of ["delete", "upsert", "import"] as const) for (const withBase of [false, true]) {
  test.describe(`${type} base=${withBase}`, () => {
    test.use({ signedIn: true })
    test("retains incompatible legacy intent through reload without retrying or claiming success", async ({ harness }) => {
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
      const chip = page.locator('[data-sync-status="compatibility"]')
      await expect(chip).toHaveText("Saved on this device. Sync needs a compatible client.")
      const saved = await page.evaluate(key => localStorage.getItem(key)!, key)
      const [paused] = JSON.parse(saved)
      const { compatibilityPause, ...retained } = paused
      expect(retained).toEqual(record)
      expect(compatibilityPause).toEqual({ code, rawRecord })
      expect(requests).toBe(1)
      await harness.expectWithinSafeViewport(chip)
      await harness.expectNoHorizontalOverflow()
      await page.reload()
      await expect(chip).toBeVisible()
      // Online/visibility/billing triggers must not resume incompatible replay.
      await page.evaluate(() => {
        window.dispatchEvent(new Event("online"))
        window.dispatchEvent(new Event("holofolder-billing-changed"))
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await expect.poll(() => page.evaluate(key => localStorage.getItem(key), key)).toBe(saved)
      // Past the ordinary first retry window, with no retry timer and no extra request.
      await page.waitForTimeout(3_000)
      expect(requests).toBe(1)
      await expect(chip).toHaveText("Saved on this device. Sync needs a compatible client.")
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBe(saved)
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
    const original = { id: "original", type: "delete", pokemonId: 1, base: SEEDED_COLLECTION[0], binderId: null, queuedAt: "original-time" }
    const rawRecord = JSON.stringify(original, null, 2)
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key, value: `[${rawRecord}]` })
    await page.reload()
    await expect.poll(() => requests).toBe(1)
    const newer = { ...original, id: "newer", queuedAt: "later-time", base: null }
    await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key, value: JSON.stringify([newer]) })
    release()
    await expect(page.locator('[data-sync-status="compatibility"]')).toBeVisible()
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
