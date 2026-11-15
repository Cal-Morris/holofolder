/**
 * "Pick all" in the card picker: add every shown card not picked yet, in order, up to `max` picks for one save.
 * Usually they all fit at once; otherwise (a preset binder running out of pockets) cards that have nowhere to go are
 * skipped one by one. `place` answers whether a set of picks fits the binder (null: no).
 */
export function pickAllCards<T extends { card: { id: string } }>(
  picks: readonly T[],
  shown: readonly T[],
  max: number,
  place: (picks: T[]) => unknown,
) {
  const fresh = shown.filter((pick) => !picks.some((p) => p.card.id === pick.card.id));
  let chosen = [...picks, ...fresh].slice(0, max);
  if (place(chosen) === null) {
    chosen = [...picks];
    for (const pick of fresh) {
      if (chosen.length >= max) break;
      if (place([...chosen, pick]) !== null) chosen.push(pick);
    }
  }
  return { picks: chosen, left: picks.length + fresh.length - chosen.length };
}
