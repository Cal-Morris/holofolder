import type { MetadataRoute } from 'next';
import { docsCanonicalUrl } from '@/lib/docs-routing';
import { docsSource } from '@/lib/docs-source';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await docsSource).getPages().map((page) => ({ url: docsCanonicalUrl(page.url) }));
}
