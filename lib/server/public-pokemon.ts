import { cacheLife, cacheTag } from 'next/cache';
import { getCardsForPokemon } from '@/lib/catalog-queries';
import { getPublicSets } from '@/lib/server/public-sets';

export interface PublicPokemonCard {
  id: string;
  setId: string;
  number: string;
  name: string;
  rarity?: string;
  illustrator?: string;
  image?: string;
}

/**
 * Every English card of a species: the app's own species lookup (`getCardsForPokemon`, tcg_card_dex_ids), kept to
 * cards printed in English in a set that has a public set page. Plain `'use cache'` so the cards land in the HTML.
 */
export async function getPublicPokemonCards(dexId: number): Promise<PublicPokemonCard[]> {
  'use cache';
  cacheLife('weeks');
  cacheTag('card-catalog', `public-pokemon:${dexId}`);
  const [sets, cards] = await Promise.all([getPublicSets(), getCardsForPokemon(dexId, 'en')]);
  const setIds = new Set(sets.map((set) => set.id));
  return cards.flatMap((card) =>
    setIds.has(card.set.id) && card.languages?.includes('en')
      ? [
          {
            id: card.id,
            setId: card.set.id,
            number: card.localId,
            name: card.name,
            ...(card.rarity ? { rarity: card.rarity } : {}),
            ...(card.illustrator ? { illustrator: card.illustrator } : {}),
            ...(card.image ? { image: card.image } : {}),
          },
        ]
      : [],
  );
}
