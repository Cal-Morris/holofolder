import { docs } from '@/.source/server'
import { loader } from 'fumadocs-core/source'
import { docsOpenAPI } from '@/lib/docs-openapi'

export const docsSource = docsOpenAPI.staticSource({
  per: 'operation', baseDir: 'reference', groupBy: 'tag', meta: true,
  name(entry) {
    if (entry.type === 'operation') {
      return this.document.paths![entry.item.path]![entry.item.method]!.operationId!.replaceAll('_', '-')
    }
    return entry.item.name
  },
}).then(openapi => loader({
  baseUrl: '/docs',
  source: { openapi, docs: docs.toFumadocsSource() },
  plugins: [docsOpenAPI.loaderPlugin()],
}))
