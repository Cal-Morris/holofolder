import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { docsCanonicalUrl } from '@/lib/docs-routing'
import { docsMarkdownHref } from '@/lib/docs-markdown'
import { docsOpenAPI } from '@/lib/docs-openapi'

test('public docs canonicals include the app prefix exactly once for guides and generated reference pages', async () => {
  const reference = await docsOpenAPI.staticSource({
    per: 'operation', baseDir: 'reference', groupBy: 'tag',
    name(entry) {
      if (entry.type === 'operation') {
        return this.document.paths![entry.item.path]![entry.item.method]!.operationId!.replaceAll('_', '-')
      }
      return entry.item.name
    },
  })
  const endpoint = reference.files.find(file => file.type === 'page')
  assert.ok(endpoint, 'the current OpenAPI contract generates reference pages')
  const referencePath = `/docs/${endpoint.path.replace(/\.mdx?$/, '')}`
  assert.match(referencePath, /^\/docs\/reference\/.+/)
  for (const slug of ['index', 'api-keys', 'mcp']) {
    assert.ok(existsSync(new URL(`../content/docs/${slug}.mdx`, import.meta.url)))
  }
  for (const path of ['/docs', '/docs/api-keys', '/docs/mcp', referencePath]) {
    const expected = `https://holofolder.com/app${path}`
    assert.equal(docsCanonicalUrl(path), expected)
    assert.equal(docsCanonicalUrl(`/app${path}`), expected)
    assert.equal(new URL(docsCanonicalUrl(path)).origin, 'https://holofolder.com')
    assert.equal(docsMarkdownHref(path), expected.replace('/docs', '/docs/markdown'))
  }
})
