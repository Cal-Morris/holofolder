import type { MetadataRoute } from 'next';
import { docsSitemapEntries } from '@/lib/docs-source';
import { pokemonByGeneration } from '@/lib/pokemon-pages';
import { getPublicSets } from '@/lib/server/public-sets';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, sets] = await Promise.all([docsSitemapEntries(), getPublicSets()]);
  return [
    ...docs,
    { url: 'https://holofolder.com/app/sets' },
    ...sets.map((set) => ({ url: `https://holofolder.com/app/sets/${set.slug}` })),
    { url: 'https://holofolder.com/app/pokemon' },
    ...pokemonByGeneration().flatMap((gen) =>
      gen.pokemon.map((pokemon) => ({ url: `https://holofolder.com/app/pokemon/${pokemon.slug}` })),
    ),
  ];
}
