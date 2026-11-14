import type { MetadataRoute } from 'next';
import { docsCanonicalUrl } from '@/lib/docs-routing';
import { docsSource } from '@/lib/docs-source';
import { getPublicSets } from '@/lib/server/public-sets';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [docs, sets] = await Promise.all([docsSource, getPublicSets()]);
  return [
    ...docs.getPages().map((page) => ({ url: docsCanonicalUrl(page.url) })),
    { url: 'https://holofolder.com/app/sets' },
    ...sets.map((set) => ({ url: `https://holofolder.com/app/sets/${set.slug}` })),
  ];
}
