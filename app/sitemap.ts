import type { MetadataRoute } from 'next';
import { docsSitemapEntries } from '@/lib/docs-source';
import { helpSitemapEntries } from '@/lib/help-source';
import { pokemonByGeneration } from '@/lib/pokemon-pages';
import { getPublicCardIds } from '@/lib/server/public-cards';
import { getPublicIllustrators } from '@/lib/server/public-illustrators';
import { getPublicSets } from '@/lib/server/public-sets';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, sets, illustrators, cardIds] = await Promise.all([
    docsSitemapEntries(),
    getPublicSets(),
    getPublicIllustrators(),
    getPublicCardIds(),
  ]);
  return [
    ...helpSitemapEntries(),
    ...docs,
    { url: 'https://holofolder.com/app/sets' },
    ...sets.map((set) => ({ url: `https://holofolder.com/app/sets/${set.slug}` })),
    { url: 'https://holofolder.com/app/pokemon' },
    ...pokemonByGeneration().flatMap((gen) =>
      gen.pokemon.map((pokemon) => ({ url: `https://holofolder.com/app/pokemon/${pokemon.slug}` })),
    ),
    { url: 'https://holofolder.com/app/search' },
    { url: 'https://holofolder.com/app/illustrators' },
    // Spellings without a count wait for migration 137; a page without English cards is noindex.
    ...illustrators.flatMap((illustrator) =>
      illustrator.cardCount ? [{ url: `https://holofolder.com/app/illustrators/${illustrator.slug}` }] : [],
    ),
    // About 22,000 cards: well inside one sitemap's 50,000 URL limit.
    ...cardIds.map((id) => ({ url: `https://holofolder.com/app/cards/${encodeURIComponent(id)}` })),
  ];
}
