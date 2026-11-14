import { docs } from '@/.source/server';
import { docsCanonicalUrl } from '@/lib/docs-routing';
import { loader } from 'fumadocs-core/source';
import { docsOpenAPI } from '@/lib/docs-openapi';
import { groupReferenceNavigation } from '@/lib/docs-navigation';

export const docsSource = docsOpenAPI
  .staticSource({
    per: 'operation',
    baseDir: 'reference',
    groupBy: 'tag',
    meta: true,
    name(entry) {
      if (entry.type === 'operation') {
        return this.document.paths![entry.item.path]![entry.item.method]!.operationId!.replaceAll('_', '-');
      }
      return entry.item.name;
    },
  })
  .then((openapi) =>
    loader({
      baseUrl: '/docs',
      source: { openapi, docs: docs.toFumadocsSource() },
      plugins: [docsOpenAPI.loaderPlugin(), { transformPageTree: { folder: groupReferenceNavigation } }],
    }),
  );

/** Sitemap entries for every public docs page (guides and generated API reference). */
export async function docsSitemapEntries() {
  return (await docsSource).getPages().map((page) => ({ url: docsCanonicalUrl(page.url) }));
}
