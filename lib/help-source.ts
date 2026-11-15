import { help } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import { docsCanonicalUrl } from '@/lib/docs-routing';

export const helpSource = loader({ baseUrl: '/help', source: help.toFumadocsSource() });

/** Sitemap entries for every help article. */
export function helpSitemapEntries() {
  return helpSource.getPages().map((page) => ({ url: docsCanonicalUrl(page.url) }));
}
