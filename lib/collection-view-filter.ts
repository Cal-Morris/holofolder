/** Binder slot filters. "needed" is labelled Missing on the binder bar; "wanted" is wanted and not owned. */
export type CollectionViewFilter = 'all' | 'owned' | 'wanted' | 'needed' | 'upgradeable' | 'favorite';

/** What a pocket holds, worked out by the caller from either native slots or legacy rows. */
export interface SlotFilterFacts {
  owned: boolean;
  wanted: boolean;
  /** Has a target but nothing owned in it yet. */
  open: boolean;
  perfect: boolean;
}

/** A native pocket: owned means a copy sits in it, whatever its status; spacers (no target, no copy) are never open. */
export function displaySlotFilterFacts(
  slot: { item: unknown; target: unknown; wantedCards: readonly unknown[] },
  status: string | null | undefined,
): SlotFilterFacts {
  return {
    owned: Boolean(slot.item),
    wanted: slot.wantedCards.length > 0,
    open: slot.target !== null && !slot.item,
    perfect: status === 'finalized',
  };
}

/** A legacy per-Pokémon row: a wishlisted row is not owned. */
export function legacyItemFilterFacts(
  item: { status: string; wanted_cards?: readonly unknown[] } | undefined,
): SlotFilterFacts {
  const owned = Boolean(item && item.status !== 'wishlisted');
  return { owned, wanted: Boolean(item?.wanted_cards?.length), open: !owned, perfect: item?.status === 'finalized' };
}

export function matchesCollectionViewFilter(facts: SlotFilterFacts, filter: CollectionViewFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'owned':
      return facts.owned;
    // Wanted means still to get: a want sitting on an owned copy is an upgrade, not a gap.
    case 'wanted':
      return facts.wanted && !facts.owned;
    case 'needed':
      return facts.open;
    case 'upgradeable':
      return facts.owned && !facts.perfect;
    case 'favorite':
      return facts.owned && facts.perfect;
  }
}
