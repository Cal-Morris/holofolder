export function shouldClearSelectedPokemonForPage(
  selectedPokemonId: number | null | undefined,
  visiblePokemonIds: ReadonlySet<number> | readonly number[],
) {
  if (!selectedPokemonId) return false
  if (Array.isArray(visiblePokemonIds)) {
    return !visiblePokemonIds.includes(selectedPokemonId)
  }

  return !visiblePokemonIds.has(selectedPokemonId)
}
