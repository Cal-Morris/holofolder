import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { emulateStandalone, SAFE_AREA, E2E_USER } from "./fixtures"
import { defaultBinderDesign, type BinderDesign } from "../lib/binder-design"

// Synthetic account appearances and PNG bytes, no live user or owned-card data.
function cloud() {
  const state = { design: defaultBinderDesign(), revision: 1, available: true, uploads: new Set<string>(), png: Buffer.alloc(0) }
  const attach = async (context: BrowserContext) => {
    await context.route("**/app/api/binder-appearance", async route => {
      if (!state.available) { await route.abort(); return }
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON() as { design: BinderDesign; baseRevision: number }
        if (body.baseRevision !== state.revision) { await route.fulfill({ status: 409, json: { ownerId: E2E_USER.id, design: state.design, revision: state.revision } }); return }
        state.design = body.design
        state.revision++
      }
      await route.fulfill({ json: { ownerId: E2E_USER.id, design: state.design, revision: state.revision } })
    })
    await context.route("**/app/api/binder-appearance/upload", async route => {
      const { id } = route.request().postDataJSON() as { id: string }
      if (state.uploads.has(id)) { await route.fulfill({ json: { exists: true } }); return }
      state.uploads.add(id)
      await route.fulfill({ json: { path: `${E2E_USER.id}/${id.slice(7)}`, token: "synthetic-upload-token" } })
    })
    await context.route("**/storage/v1/object/upload/sign/**", route => route.fulfill({ json: { Key: "synthetic-artwork" } }))
    await context.route("**/app/api/binder-appearance/artwork?**", route => route.fulfill({ contentType: "image/png", body: state.png }))
    await context.route("**/app/api/card-image-proxy?**", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="315" height="440"><rect width="315" height="440" fill="#c8bbc9"/></svg>' }))
  }
  return { state, attach }
}
async function words(page: Page, text: string) {
  const input = page.getByLabel("Words", { exact: true })
  if (!await input.isVisible()) await page.locator("summary").filter({ hasText: /^Lettering/ }).click()
  await input.fill(text)
}
async function ready(page: Page) {
  await page.goto("/app/e2e-harness/studio")
  await expect(page.getByRole("button", { name: "Save appearance", exact: true })).toBeEnabled()
}

test("two independent devices share artwork, placement and coordinated appearance", async ({ page, browser }, info) => {
  const backend = cloud()
  await backend.attach(page.context())
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await ready(page)
  await page.locator("summary").filter({ hasText: /^Presets$/ }).click()
  await page.getByRole("button", { name: "Apply Oxblood preset" }).click()
  await words(page, "Shared favourites")
  backend.state.png = Buffer.from(await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 300; c.height = 400; const x = c.getContext("2d")!; x.fillStyle = "#aa2244"; x.fillRect(0, 0, 300, 400); return c.toDataURL("image/png").split(",")[1] }), "base64")
  await page.getByLabel("Upload artwork", { exact: true }).setInputFiles({ name: "synthetic.png", mimeType: "image/png", buffer: backend.state.png })
  await expect(page.getByLabel("Artwork zoom", { exact: true })).toBeVisible()
  await page.getByLabel("Artwork zoom", { exact: true }).fill("2")
  await page.getByLabel("Horizontal placement", { exact: true }).fill("0.4")
  await page.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: /^Saved to your account\./ })).toBeVisible()
  expect(backend.state.revision).toBe(2)
  const second = await browser.newContext({ viewport: info.project.use.viewport })
  try {
    await backend.attach(second)
    const device = await second.newPage()
    if (info.project.metadata.standalone) await emulateStandalone(device, SAFE_AREA)
    await ready(device)
    if (!await device.getByLabel("Words", { exact: true }).isVisible()) await device.locator("summary").filter({ hasText: /^Lettering/ }).click()
    await expect(device.getByLabel("Words", { exact: true })).toHaveValue("Shared favourites")
    await expect(device.getByLabel("Surface colour", { exact: true })).toHaveValue("#5b2930")
    await expect(device.getByLabel("Artwork zoom", { exact: true })).toHaveValue("2")
    await expect(device.getByLabel("Horizontal placement", { exact: true })).toHaveValue("0.4")
    await expect.poll(() => device.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("binderdex-appearance", 1); r.onsuccess = () => resolve(r.result) })
      return new Promise<number>(resolve => { const r = db.transaction("designs").objectStore("designs").get("owner:00000000-0000-4000-8000-0000000000e2"); r.onsuccess = () => { const bytes = Object.values(r.result?.uploads ?? {}).reduce<number>((sum, blob) => sum + (blob instanceof Blob ? blob.size : 0), 0); db.close(); resolve(bytes) } })
    })).toBe(backend.state.png.length)
  } finally { await second.close() }
})

test("offline saves survive reload and resume syncing without replacing the draft", async ({ page }, info) => {
  const backend = cloud()
  await backend.attach(page.context())
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await ready(page)
  await words(page, "Queued offline")
  await page.context().setOffline(true)
  await page.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Will sync when you’re online" })).toBeVisible()
  backend.state.available = false
  await page.context().setOffline(false)
  await page.reload()
  await expect(page.getByRole("button", { name: "Save appearance", exact: true })).toBeEnabled()
  if (!await page.getByLabel("Words", { exact: true }).isVisible()) await page.locator("summary").filter({ hasText: /^Lettering/ }).click()
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("Queued offline")
  expect(backend.state.revision).toBe(1)
  backend.state.available = true
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect.poll(() => backend.state.revision).toBe(2)
  expect(backend.state.design.surfaces.cover.words).toBe("Queued offline")
})

test("stale device saves preserve both the newer account appearance and local draft", async ({ page }, info) => {
  const backend = cloud()
  await backend.attach(page.context())
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await ready(page)
  await words(page, "Local draft")
  backend.state.design.surfaces.cover.words = "Other device"
  backend.state.revision = 2
  await page.evaluate(() => window.dispatchEvent(new Event("online")))
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("binderdex-appearance", 1); r.onsuccess = () => resolve(r.result) })
    return new Promise<number>(resolve => { const r = db.transaction("designs").objectStore("designs").get("owner:00000000-0000-4000-8000-0000000000e2"); r.onsuccess = () => { db.close(); resolve(r.result?.revision ?? 0) } })
  })).toBe(2)
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("Local draft")
  await page.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "changed on another device" })).toBeVisible()
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("Local draft")
  expect(backend.state.design.surfaces.cover.words).toBe("Other device")
  expect(backend.state.revision).toBe(2)
  await page.getByRole("button", { name: "Load latest appearance", exact: true }).click()
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("Other device")
})

test("another tab cannot replace an unsynced device appearance", async ({ page }, info) => {
  const backend = cloud()
  await backend.attach(page.context())
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await ready(page)
  const other = await page.context().newPage()
  if (info.project.metadata.standalone) await emulateStandalone(other, SAFE_AREA)
  await ready(other)
  await words(page, "First queued draft")
  await words(other, "Other tab draft")
  await page.context().setOffline(true)
  await page.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Will sync when you’re online" })).toBeVisible()
  await other.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(other.getByRole("status").filter({ hasText: "changed on another device" })).toBeVisible()
  await expect(other.getByLabel("Words", { exact: true })).toHaveValue("Other tab draft")
  expect(await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open("binderdex-appearance", 1); r.onsuccess = () => resolve(r.result) })
    return new Promise<string>(resolve => { const r = db.transaction("designs").objectStore("designs").get("owner:00000000-0000-4000-8000-0000000000e2"); r.onsuccess = () => { db.close(); resolve(r.result?.design.surfaces.cover.words) } })
  })).toBe("First queued draft")
  await page.context().setOffline(false)
  await expect.poll(() => backend.state.design.surfaces.cover.words).toBe("First queued draft")
  await other.close()
})

test("accepting an empty account appearance cannot resurrect a discarded pending save", async ({ page }, info) => {
  const backend = cloud()
  await backend.attach(page.context())
  if (info.project.metadata.standalone) await emulateStandalone(page, SAFE_AREA)
  await ready(page)
  await words(page, "Discard this pending draft")
  await page.route("**/app/api/binder-appearance", route => route.fulfill({ status: route.request().method() === "PUT" ? 409 : 200, json: { ownerId: E2E_USER.id, design: null, revision: 0 } }))
  await page.getByRole("button", { name: "Save appearance", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "changed on another device" })).toBeVisible()
  await page.getByRole("button", { name: "Load latest appearance", exact: true }).click()
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("")
  await page.reload()
  await expect(page.getByRole("button", { name: "Save appearance", exact: true })).toBeEnabled()
  if (!await page.getByLabel("Words", { exact: true }).isVisible()) await page.locator("summary").filter({ hasText: /^Lettering/ }).click()
  await expect(page.getByLabel("Words", { exact: true })).toHaveValue("")
})
