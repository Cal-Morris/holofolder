export function shouldClearSelectedPokemonForPage(
  selectedPokemonId: number | null | undefined,
  visiblePokemonIds: ReadonlySet<number> | readonly number[],
) {
  if (!selectedPokemonId) return false
  if (isReadonlyNumberArray(visiblePokemonIds)) {
    return !visiblePokemonIds.includes(selectedPokemonId)
  }

  return !visiblePokemonIds.has(selectedPokemonId)
}

function isReadonlyNumberArray(value: ReadonlySet<number> | readonly number[]): value is readonly number[] {
  return Array.isArray(value)
}
