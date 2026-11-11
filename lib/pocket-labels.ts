import type { GradingRecord, InventoryIdentity } from '@/lib/domain/inventory';
import type { SlotTarget } from '@/lib/domain/binder-slots';
import type { CardLanguage } from '@/lib/domain/cards';
import type { DisplayCatalogCard, ReadOnlyDisplaySlot } from '@/lib/binder-display-model';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import { formatPokemonDisplayName, getPokemonSummary } from '@/lib/pokemon-catalog';

/** A card ID standing in for a name the catalog has not supplied yet (the display model's unresolved fallback). */
const looksLikeCardId = (card: NonNullable<ReadOnlyDisplaySlot['card']>) =>
  !card.image && !card.set && !card.localId && /^[a-z0-9.]+-[a-z0-9]+$/i.test(card.name);

/** The name a person reads for a pocket: the recorded card name as printed, else the formatted Pokémon name. */
export function displaySlotName(slot: Pick<ReadOnlyDisplaySlot, 'card' | 'pokemon' | 'target'>): string {
  if (slot.card && !looksLikeCardId(slot.card)) return slot.card.name;
  if (slot.pokemon) return formatPokemonDisplayName(slot.pokemon.name);
  if (slot.card) return 'Card';
  return slot.target?.kind === 'pokemon' ? `Pokémon #${slot.target.pokemonId}` : 'Empty pocket';
}

/** "PSA 9", "CGC 9.5", "My grader · Unknown grade". Recorded values only, never a certificate. */
export function formatGradeLabel(grade: GradingRecord): string {
  const provider =
    grade.provider.kind === 'known'
      ? grade.provider.id === 'beckett'
        ? 'Beckett'
        : grade.provider.id.toUpperCase()
      : grade.provider.name;
  return `${provider} ${grade.grade ?? '· Unknown grade'}`;
}

/** "Page 3 · Pocket 7" for a position in the saved order. Presentation only, never an identity. */
export function pocketPlace(index: number, rows: number, cols: number): string {
  const capacity = rows * cols;
  return `Page ${Math.floor(index / capacity) + 1} · Pocket ${(index % capacity) + 1}`;
}

export type CardNamer = (cardId: string, language?: CardLanguage) => DisplayCatalogCard | undefined;

/** A copy or a reserved printing in words: the name first, then its printing. IDs are never the label. */
export function describeIdentity(
  identity: InventoryIdentity | SlotTarget,
  namer?: CardNamer,
): { name: string; detail: string; image?: string } {
  if (identity.kind === 'pokemon') {
    const pokemon = getPokemonSummary(identity.pokemonId);
    return {
      name: pokemon ? formatPokemonDisplayName(pokemon.name) : `Pokémon #${identity.pokemonId}`,
      detail: 'Any card',
    };
  }
  const card = namer?.(identity.cardId, identity.language);
  return {
    name: card?.name ?? 'Card',
    image: card?.image,
    detail:
      [
        card?.set?.name,
        card?.localId ? `#${card.localId}` : null,
        identity.language ? formatCardLanguageLabel(identity.language) : null,
        identity.finish ? formatCardFinishLabel(identity.finish) : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'Printing details unavailable',
  };
}
