import { test, expect, type Harness } from "./fixtures"
import type { Locator, Page } from "@playwright/test"

type OverlaySpec = {
  name: string
  /** Opens the overlay and returns its dialog locator plus the element that should regain focus. */
  open: (harness: Harness) => Promise<{ dialog: Locator; opener: Locator }>
  bottomSheet: boolean
  backdrop: boolean
  /** Overlays that are only reachable for a signed-in user. */
  signedIn?: boolean
  /** Nested overlays return to their parent overlay (matched by accessible name) when closed. */
  returnsTo?: RegExp
}

function header(page: Page) {
  return page.locator("nav").first()
}

const overlays: OverlaySpec[] = [
  {
    name: "card detail",
    open: async (harness) => {
      const opener = harness.page.locator("button[data-dex-id=\"1\"]").first()
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /bulbasaur/i }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "search",
    open: async (harness) => {
      const opener = harness.dock().getByRole("button", { name: "Search", exact: true })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /search pokemon/i }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "view options",
    open: async (harness) => {
      const opener = header(harness.page).getByRole("button", { name: "View", exact: true })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: "View options", exact: true }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "settings",
    open: async (harness) => {
      const opener = header(harness.page).getByRole("button", { name: "More", exact: true })
      await opener.click()
      await harness.page.getByRole("menuitem", { name: "Settings" }).click()
      return { dialog: harness.page.getByRole("dialog", { name: /settings/i }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "sign in",
    open: async (harness) => {
      const opener = header(harness.page).getByRole("button", { name: "More", exact: true })
      await opener.click()
      await harness.page.getByRole("menuitem", { name: "Sign in", exact: true }).click()
      return { dialog: harness.page.getByRole("dialog", { name: /welcome|sign in/i }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "all cards view",
    open: async (harness) => {
      const detail = await harness.openCardDetail()
      const opener = detail.getByRole("button", { name: /all bulbasaur cards/i })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /all bulbasaur cards/i }), opener }
    },
    returnsTo: /bulbasaur details/i,
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "card selector",
    open: async (harness) => {
      const detail = await harness.openCardDetail()
      const opener = detail.getByRole("button", { name: /change owned card|add owned card/i }).first()
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /card selector/i }), opener }
    },
    signedIn: true,
    returnsTo: /bulbasaur/i,
    bottomSheet: true,
    backdrop: true,
  },
]

async function expectClosed(harness: Harness, dialog: Locator, returnsTo?: RegExp) {
  await expect(dialog).toBeHidden()
  if (returnsTo) {
    // Closing a nested overlay goes back exactly one level.
    await expect(harness.page.getByRole("dialog", { name: returnsTo })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(1)
  } else {
    await expect(harness.dialogs()).toHaveCount(0)
    await harness.expectScrollUnlocked()
  }
  await expect(harness.page).toHaveURL(/\/app\/e2e-harness/)
}

for (const overlay of overlays) {
  test.describe(overlay.name, () => {
    test.use({ signedIn: Boolean(overlay.signedIn) })

    test("fits the safe viewport with a reachable close control", async ({ harness }) => {
      const { dialog } = await overlay.open(harness)
      await expect(dialog).toBeVisible()
      await expect(harness.dialogs()).toHaveCount(1)
      const close = harness.closeControl(dialog)
      await expect(close).toBeVisible()
      await harness.expectWithinSafeViewport(close)
      await harness.expectHittable(close)
      await harness.expectMinTapTarget(close)
      const box = (await dialog.boundingBox())!
      expect(box.y, "dialog must not run under the status bar").toBeGreaterThanOrEqual(harness.insets.top - 0.5)
      expect(box.y + box.height).toBeLessThanOrEqual(harness.viewport.height + 0.5)
      await harness.expectNoHorizontalOverflow()
    })

    test("closes with the close button and returns focus", async ({ harness }) => {
      const { dialog, opener } = await overlay.open(harness)
      await expect(dialog).toBeVisible()
      await harness.closeControl(dialog).click()
      await expectClosed(harness, dialog, overlay.returnsTo)
      if (await opener.isVisible()) {
        await expect(opener).toBeFocused()
      }
    })

    test("closes with Escape", async ({ harness }) => {
      const { dialog } = await overlay.open(harness)
      await expect(dialog).toBeVisible()
      await harness.page.keyboard.press("Escape")
      await expectClosed(harness, dialog, overlay.returnsTo)
    })

    test("closes with the browser back button without leaving the page", async ({ harness }) => {
      const { dialog } = await overlay.open(harness)
      await expect(dialog).toBeVisible()
      await harness.page.goBack()
      await expectClosed(harness, dialog, overlay.returnsTo)
      await expect(harness.dock()).toBeVisible()
    })

    if (overlay.backdrop) {
      test("closes when tapping the backdrop", async ({ harness }) => {
        const { dialog } = await overlay.open(harness)
        await expect(dialog).toBeVisible()
        await harness.tapBackdrop(dialog)
        await expectClosed(harness, dialog, overlay.returnsTo)
      })
    }

    if (overlay.bottomSheet) {
      test("closes with swipe down on the grabber", async ({ harness }) => {
        const { dialog } = await overlay.open(harness)
        await expect(dialog).toBeVisible()
        await harness.swipeDown(dialog)
        await expectClosed(harness, dialog, overlay.returnsTo)
      })

      test("closes with a touch pull down on its body from the top", async ({ harness }) => {
        const { dialog } = await overlay.open(harness)
        await expect(dialog).toBeVisible()
        const point = await bodyPoint(dialog)
        await touchDrag(harness.page, point.x, point.y, 220)
        await expectClosed(harness, dialog, overlay.returnsTo)
      })
    }
  })
}

/** A point on the dialog's body (not its grabber or a text field), where a touch should drag the sheet. */
function bodyPoint(dialog: Locator) {
  return dialog.evaluate((sheet) => {
    const rect = sheet.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    for (let share = 0.45; share <= 0.85; share += 0.05) {
      const y = rect.top + rect.height * share
      const hit = document.elementFromPoint(x, y)
      if (hit && sheet.contains(hit) && !hit.closest("[data-sheet-grabber], input, textarea, select, [data-no-swipe]")) return { x, y }
    }
    throw new Error("No draggable body point found")
  })
}

/** A real (CDP) touch drag, so the browser decides between scrolling and our drag like a phone does. */
async function touchDrag(page: Page, x: number, y: number, distance: number) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + (distance * step) / 10 }] })
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
  await cdp.detach()
}

test("a scrolled sheet body scrolls back up instead of closing", async ({ harness }) => {
  // Short enough that the Settings body overflows on every project.
  await harness.page.setViewportSize({ width: harness.viewport.width, height: 560 })
  await header(harness.page).getByRole("button", { name: "More", exact: true }).click()
  await harness.page.getByRole("menuitem", { name: "Settings" }).click()
  const dialog = harness.page.getByRole("dialog", { name: /settings/i })
  await expect(dialog).toBeVisible()
  const before = await dialog.evaluate((sheet) => {
    const scroller = Array.from(sheet.querySelectorAll<HTMLElement>("*")).find(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 120)
    if (!scroller) throw new Error("Settings body should overflow")
    scroller.dataset.testScroller = ""
    scroller.scrollTop = 120
    return scroller.scrollTop
  })
  const point = await bodyPoint(dialog)
  await touchDrag(harness.page, point.x, point.y, 60)
  await expect.poll(() => dialog.locator("[data-test-scroller]").evaluate(node => node.scrollTop)).toBeLessThan(before)
  await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(sheet => sheet.style.translate)).toBe("")
})

const dockTabs = ["Binder", "List", "Wanted", "Browse", "Search"] as const
const binderOverlays = overlays.filter((overlay) => ["card detail", "view options", "search", "all cards view"].includes(overlay.name))

test.describe("bottom navigation", () => {
  // Signed in so every dock control (including the collection filter) is enabled.
  test.use({ signedIn: true })

  for (const overlay of binderOverlays) {
    test(`switching tabs with ${overlay.name} open closes it and keeps one overlay at most`, async ({ harness }) => {
      for (const tab of dockTabs) {
        await harness.page.goto(harness.path)
        await expect(harness.dock()).toBeVisible()
        const { dialog } = await overlay.open(harness)
        await expect(dialog).toBeVisible()

        const tabButton = harness.dock().getByRole("button", { name: tab, exact: true })
        await harness.expectHittable(tabButton)
        await tabButton.click()

        if (tab === "Search") {
          await expect(harness.page.getByRole("dialog", { name: /search pokemon/i })).toBeVisible()
          await expect(harness.dialogs()).toHaveCount(1)
        } else {
          await expect(harness.dialogs()).toHaveCount(0)
          await harness.expectScrollUnlocked()
        }
        await expect(harness.dock()).toBeVisible()
        await harness.expectNoHorizontalOverflow()
      }
    })
  }

  test("opening another overlay from the header replaces the card detail", async ({ harness }) => {
    await harness.openCardDetail()
    // On phones the card detail is modal, so the header sits under its backdrop; trigger the
    // header control directly to make sure overlays never stack when opened programmatically.
    await header(harness.page).getByRole("button", { name: "More", exact: true }).dispatchEvent("click")
    await harness.page.getByRole("menuitem", { name: "Settings" }).dispatchEvent("click")
    await expect(harness.page.getByRole("dialog", { name: /settings/i })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(1)
  })

  test("opening view options replaces the card detail", async ({ harness }) => {
    await harness.openCardDetail()
    await header(harness.page).getByRole("button", { name: "View", exact: true }).dispatchEvent("click")
    await expect(harness.page.getByRole("dialog", { name: "View options", exact: true })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(1)
  })

  test("every main view has no horizontal overflow and keeps the dock usable", async ({ harness }) => {
    for (const tab of ["List", "Wanted", "Browse", "Binder"] as const) {
      await harness.dock().getByRole("button", { name: tab, exact: true }).click()
      await harness.expectNoHorizontalOverflow()
      // The nav's own box extends behind the home indicator; its visible bar must clear it.
      await harness.expectWithinSafeViewport(harness.dock().locator(":scope > div").first())
      await expect(() => harness.expectHittable(harness.dock().getByRole("button", { name: tab, exact: true }))).toPass({ timeout: 1000 })
    }
  })

  test("card detail Prev/Next moves between slots without closing", async ({ harness }) => {
    const detail = await harness.openCardDetail()
    await detail.getByRole("button", { name: /^next/i }).click()
    await expect(harness.dialogs()).toHaveCount(1)
  })
})
