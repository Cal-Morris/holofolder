export function completeCardSelectorSelection({ onClose, onSelect }: { onClose: () => void; onSelect: () => void }) {
  onClose();
  onSelect();
}

export function beginBinderCardSelection({
  onCloseSelector,
  onCloseSelectedSlot,
}: {
  onCloseSelector: () => void;
  onCloseSelectedSlot: () => void;
}) {
  onCloseSelector();
  onCloseSelectedSlot();
}
