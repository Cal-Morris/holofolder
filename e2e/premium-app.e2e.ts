import { test, expect } from "./fixtures"

test("binder settings retain page colours and expose the 3D studio", async ({ harness }) => {
  await harness.page.locator("nav").first().getByRole("button", { name: /open settings/i }).click()
  const settings = harness.page.getByRole("dialog", { name: /settings/i })
  const studio = settings.getByRole("link", { name: /customise binder/i })
  await expect(studio).toHaveAttribute("href", "/studio")
  await harness.expectMinTapTarget(studio)
  await harness.expectWithinSafeViewport(studio)
  await settings.getByRole("button", { name: "Display", exact: true }).click()
  await settings.getByRole("button", { name: "Ruby", exact: true }).click()
  const apply = settings.getByRole("button", { name: "Use for page 1", exact: true })
  await apply.scrollIntoViewIfNeeded()
  await apply.click()
  await expect(settings.getByText(/Page 1 is currently using Ruby via a page override/)).toBeVisible()
  await harness.expectNoHorizontalOverflow()
})

test("printing browser keeps a physical card outline at every size", async ({ harness }) => {
  const detail = await harness.openCardDetail()
  await detail.getByRole("button", { name: /all bulbasaur cards/i }).click()
  const dialog = harness.page.getByRole("dialog", { name: /all bulbasaur cards/i })
  const card = dialog.locator(".trading-card").first()
  await expect(card).toBeVisible()
  const dimensions = await card.evaluate((element) => {
    const { width, height } = element.getBoundingClientRect()
    return { ratio: width / height, radius: getComputedStyle(element).borderRadius }
  })
  expect(dimensions.ratio).toBeCloseTo(63 / 88, 2)
  expect(dimensions.radius).toBe("4.76% / 3.41%")
  await harness.expectNoHorizontalOverflow()
})
