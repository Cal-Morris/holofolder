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
    bottomSheet: false,
    backdrop: true,
  },
  {
    name: "controls sheet",
    open: async (harness) => {
      const opener = harness.dock().getByRole("button", { name: /open controls/i })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /controls/i }), opener }
    },
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "filter sheet",
    open: async (harness) => {
      const opener = harness.dock().getByRole("button", { name: /^filter/i })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /binder view/i }), opener }
    },
    signedIn: true,
    bottomSheet: true,
    backdrop: true,
  },
  {
    name: "settings",
    open: async (harness) => {
      const opener = header(harness.page).getByRole("button", { name: /open settings/i })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /settings/i }), opener }
    },
    bottomSheet: false,
    backdrop: true,
  },
  {
    name: "sign in",
    open: async (harness) => {
      const opener = header(harness.page).getByRole("button", { name: /sign in/i })
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /welcome|sign in/i }), opener }
    },
    bottomSheet: false,
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
      const opener = detail.getByRole("button", { name: /edit card|add card/i }).first()
      await opener.click()
      return { dialog: harness.page.getByRole("dialog", { name: /card selector/i }), opener }
    },
    signedIn: true,
    returnsTo: /bulbasaur/i,
    bottomSheet: false,
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
  await expect(harness.page).toHaveURL(/\/e2e-harness/)
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
    }
  })
}

const dockTabs = ["Binder", "List", "Wanted", "Sets", "Search"] as const
const binderOverlays = overlays.filter((overlay) => ["card detail", "controls sheet", "filter sheet", "search", "all cards view"].includes(overlay.name))

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
    await header(harness.page).getByRole("button", { name: /open settings/i }).dispatchEvent("click")
    await expect(harness.page.getByRole("dialog", { name: /settings/i })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(1)
  })

  test("opening a dock sheet replaces the card detail", async ({ harness }) => {
    await harness.openCardDetail()
    await harness.dock().getByRole("button", { name: /open controls/i }).click()
    await expect(harness.page.getByRole("dialog", { name: /controls/i })).toBeVisible()
    await expect(harness.dialogs()).toHaveCount(1)
  })

  test("every main view has no horizontal overflow and keeps the dock usable", async ({ harness }) => {
    for (const tab of ["List", "Wanted", "Sets", "Binder"] as const) {
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
