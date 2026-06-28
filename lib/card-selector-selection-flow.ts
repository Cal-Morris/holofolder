export function completeCardSelectorSelection({
  onClose,
  onSelect,
}: {
  onClose: () => void
  onSelect: () => void
}) {
  onClose()
  onSelect()
}
