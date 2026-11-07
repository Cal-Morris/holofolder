import { test, expect } from "./fixtures"

test.use({ signedIn: true })

const themeCookie = async (page: import("@playwright/test").Page) =>
  (await page.context().cookies()).find(cookie => cookie.name === "binderdex_theme")?.value

test("the theme cookie is only written when the user switches theme", async ({ harness }) => {
  const { page } = harness
  await page.context().clearCookies({ name: "binderdex_theme" })
  await page.goto("/app/e2e-harness?signedIn=1")
  await expect(page.getByTestId("app-header")).toBeVisible()
  const startedDark = await page.evaluate(() => document.documentElement.classList.contains("dark"))
  expect(await themeCookie(page), "loading the app does not save a theme").toBeUndefined()

  const toggle = async () => {
    await page.getByTestId("app-header").getByRole("button", { name: "More", exact: true }).click()
    await page.getByRole("menu", { name: "More" }).getByRole("menuitem", { name: /^(Dark|Light) mode$/ }).click()
  }
  await toggle()
  await expect(page.locator("html")).toHaveClass(startedDark ? /^(?!.*\bdark\b)/ : /\bdark\b/)
  await expect.poll(() => themeCookie(page)).toBe(startedDark ? "light" : "dark")
  await toggle()
  await expect.poll(() => themeCookie(page)).toBe(startedDark ? "dark" : "light")
})
