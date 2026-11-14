import { knownRarity, type CatalogueCard } from '@/lib/catalogue-cards';
import { findPokemonById } from '@/lib/pokemon-pages';
import { formatCardNumber, type PublicSetSummary } from '@/lib/set-pages';

/**
 * A card from our catalogue, in a set with a public page, as the public card grid shows it: the printed number
 * ("12/131"), its set's page and, for a card of exactly one Pokémon, that species' page. Server only: the species
 * lookup carries the National Dex.
 */
export function toPublicCatalogueCard(
  card: {
    id: string;
    name: string;
    /** As stored: "12", "SWSH050". */
    number: string;
    rarity?: string;
    illustrator?: string;
    image?: string;
    dexIds?: readonly number[];
  },
  set: PublicSetSummary,
): CatalogueCard {
  const pokemon = card.dexIds?.length === 1 ? findPokemonById(card.dexIds[0]) : undefined;
  return {
    id: card.id,
    name: card.name,
    number: formatCardNumber(card.number, set.officialCardCount),
    setName: set.name,
    setSlug: set.slug,
    ...(set.seriesName ? { series: set.seriesName } : {}),
    ...(set.releaseDate ? { releaseDate: set.releaseDate } : {}),
    ...(knownRarity(card.rarity) ? { rarity: card.rarity } : {}),
    ...(card.illustrator ? { illustrator: card.illustrator } : {}),
    ...(card.image ? { image: card.image } : {}),
    ...(pokemon ? { pokemon: { slug: pokemon.slug, name: pokemon.name } } : {}),
  };
}
