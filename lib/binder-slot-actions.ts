export function getBinderSlotQuickActions({
  hasAssignedCard,
  readOnly,
}: {
  hasAssignedCard: boolean
  readOnly: boolean
}) {
  return {
    addLabel: hasAssignedCard ? "Edit" : "Add",
    addAccessibleLabel: hasAssignedCard ? "Edit card" : "Add card",
    wantLabel: "Want",
    wantAccessibleLabel: "Want card",
    canShowActions: !readOnly,
  }
}
