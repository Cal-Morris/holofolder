import type { MetadataRoute } from 'next';
import { docsSitemapEntries } from '@/lib/docs-source';
import { pokemonByGeneration } from '@/lib/pokemon-pages';
import { getPublicIllustrators } from '@/lib/server/public-illustrators';
import { getPublicSets } from '@/lib/server/public-sets';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, sets, illustrators] = await Promise.all([
    docsSitemapEntries(),
    getPublicSets(),
    getPublicIllustrators(),
  ]);
  return [
    ...docs,
    { url: 'https://holofolder.com/app/sets' },
    ...sets.map((set) => ({ url: `https://holofolder.com/app/sets/${set.slug}` })),
    { url: 'https://holofolder.com/app/pokemon' },
    ...pokemonByGeneration().flatMap((gen) =>
      gen.pokemon.map((pokemon) => ({ url: `https://holofolder.com/app/pokemon/${pokemon.slug}` })),
    ),
    { url: 'https://holofolder.com/app/illustrators' },
    // Spellings without a count wait for migration 137; a page without English cards is noindex.
    ...illustrators.flatMap((illustrator) =>
      illustrator.cardCount ? [{ url: `https://holofolder.com/app/illustrators/${illustrator.slug}` }] : [],
    ),
  ];
}
