import test from "node:test"
import assert from "node:assert/strict"
import { getCardSelectorQuickActions } from "../lib/card-selector-actions"

test("getCardSelectorQuickActions emphasizes Add in collect mode", () => {
  const actions = getCardSelectorQuickActions("collect")

  assert.deepEqual(actions, [
    {
      mode: "collect",
      label: "Add",
      accessibleLabel: "Add card",
      isPrimary: true,
    },
    {
      mode: "wishlist",
      label: "Want",
      accessibleLabel: "Want card",
      isPrimary: false,
    },
  ])
})

test("getCardSelectorQuickActions emphasizes Want in wishlist mode", () => {
  const actions = getCardSelectorQuickActions("wishlist")

  assert.deepEqual(actions, [
    {
      mode: "collect",
      label: "Add",
      accessibleLabel: "Add card",
      isPrimary: false,
    },
    {
      mode: "wishlist",
      label: "Want",
      accessibleLabel: "Want card",
      isPrimary: true,
    },
  ])
})
