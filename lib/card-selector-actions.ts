export type CardSelectorActionMode = "collect" | "wishlist"

export type CardSelectorQuickAction = {
  mode: CardSelectorActionMode
  label: string
  accessibleLabel: string
  isPrimary: boolean
}

export function getCardSelectorQuickActions(activeMode: CardSelectorActionMode): CardSelectorQuickAction[] {
  return [
    {
      mode: "collect",
      label: "Add",
      accessibleLabel: "Add card",
      isPrimary: activeMode === "collect",
    },
    {
      mode: "wishlist",
      label: "Want",
      accessibleLabel: "Want card",
      isPrimary: activeMode === "wishlist",
    },
  ]
}
