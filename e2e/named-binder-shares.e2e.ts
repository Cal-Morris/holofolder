import { test, expect, type Harness } from "./fixtures"

test.use({ signedIn: true })

async function settings(harness: Harness) {
  await harness.page.getByRole("button", { name: "More", exact: true }).click()
  await harness.page.getByRole("menuitem", { name: "Settings", exact: true }).click()
  return harness.page.getByRole("dialog", { name: "Settings", exact: true })
}

// Synthetic identity backends, intentionally not availability claims against real accounts.
test("owner explicitly saves account username and binder slug, then gets the saved public address", async ({ harness, page }) => {
  let username = "synthetic-old"
  let slug: string | null = null
  await page.route("**/app/api/account-identity", async route => {
    if (route.request().method() === "PATCH") username = route.request().postDataJSON().username
    await route.fulfill({ json: { username, available: true } })
  })
  await page.route("**/app/api/binder-identity**", async route => {
    if (route.request().method() === "PATCH") slug = route.request().postDataJSON().slug
    await route.fulfill({ json: { username, slug, available: true, canEdit: true } })
  })
  await page.route("**/app/api/binder-share**", route => route.fulfill({ json: { share: { token: "synthetic-token", is_enabled: true, path: slug ? `/@${username}/${slug}` : "/app/share/synthetic-token" } } }))
  await page.goto("/app/e2e-harness?signedIn=1&binders=1")
  const dialog = await settings(harness)
  await dialog.getByRole("button", { name: "Account", exact: true }).click()
  const account = dialog.getByRole("region", { name: "Public username" })
  await expect(account.getByLabel("Username", { exact: true })).toHaveValue(username)
  await account.getByLabel("Username", { exact: true }).fill("Synthetic-New")
  await expect(account).toContainText("breaks previous named links")
  await account.getByRole("button", { name: "Save", exact: true }).click()
  await expect(account.getByRole("status")).toHaveText("Username saved.")
  expect(username).toBe("synthetic-new")
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  const binder = dialog.getByRole("region", { name: "Binder address" })
  await expect(binder.getByLabel("Binder slug")).toBeEnabled()
  await binder.getByLabel("Binder slug").fill("National")
  await binder.getByRole("button", { name: "Save", exact: true }).click()
  await expect(binder).toContainText("holofolder.com/@synthetic-new/national")
  await expect(dialog.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled()
  await harness.expectNoHorizontalOverflow()
})

test("partner sees owner address but cannot rename it, unavailable schema preserves token sharing", async ({ harness, page }) => {
  await page.route("**/app/api/binder-identity**", route => route.fulfill({ json: { username: "synthetic-owner", slug: "national", canEdit: false, available: true } }))
  await page.route("**/app/api/binder-share**", route => route.fulfill({ json: { share: { token: "synthetic-token", is_enabled: true, path: "/app/share/synthetic-token" } } }))
  await page.goto("/app/e2e-harness?signedIn=1&binders=1&partner=1")
  const dialog = await settings(harness)
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  const binder = dialog.getByRole("region", { name: "Binder address" })
  await expect(binder.getByLabel("Binder slug")).toHaveValue("national")
  await expect(binder.getByLabel("Binder slug")).toBeDisabled()
  await expect(binder).toContainText("Only the binder owner")
  await dialog.getByRole("button", { name: "Account", exact: true }).click()
  await expect(dialog.getByRole("region", { name: "Public username" })).toContainText("Named links are not available yet")
  await dialog.getByRole("button", { name: "Share", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Copy link", exact: true })).toBeEnabled()
})
