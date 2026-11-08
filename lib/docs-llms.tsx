import type { ReactNode } from 'react'
import { asMarkdown, md } from 'fumadocs-core/server'
import { llms } from 'fumadocs-core/source/llms'
import { docsSource } from '@/lib/docs-source'
import { docsMarkdownHref, formatEndpointMarkdown, rewriteDocsLinks } from '@/lib/docs-markdown'

type DocsPage = NonNullable<ReturnType<Awaited<typeof docsSource>['getPage']>>
const components = {
  DocsApiKeys: () => { asMarkdown(); return '[Create or manage an API key in the interactive guide](https://holofolder.com/app/docs/api-keys#create-a-key)\n' },
  Cards: ({ children }: { children?: ReactNode }) => { asMarkdown(); return children },
  Card: ({ title, description, href }: { title: string; description?: string; href: string }) => { asMarkdown(); return `- [${title}](${docsMarkdownHref(href)}): ${description ?? ''}\n` },
  Callout: ({ title, children }: { title?: string; children?: ReactNode }) => { asMarkdown(); return md`**${title ?? 'Note'}**\n\n${children}\n\n` },
  DocsLink: ({ href, children }: { href: string; children?: ReactNode }) => { asMarkdown(); return md`[${children}](${docsMarkdownHref(href)})` },
}

async function renderPage(page: DocsPage): Promise<string> {
  if (page.type === 'openapi') {
    const { operations = [] } = page.data.getOpenAPIPageProps()
    const { bundled } = page.data.getSchema()
    return operations.map(({ path, method }) => formatEndpointMarkdown({
      title: page.data.title ?? 'API operation', url: page.url, method, path, operation: bundled.paths?.[path]?.[method],
    })).join('\n')
  }
  const body = await page.data.getText('processed', { components })
  return `# ${page.data.title}\n\nSource: https://holofolder.com/app${page.url}\n\n${page.data.description ?? ''}\n\n${rewriteDocsLinks(body)}`
}

export const docsLLMs = llms(() => docsSource, {
  renderUrl: node => docsMarkdownHref(node.url),
  renderPage,
})

export const agentDocsLinks = `## Machine-readable resources

- [All documentation in one file](https://holofolder.com/app/docs/llms-full.txt)
- [OpenAPI 3.1 contract](https://holofolder.com/app/openapi.json)
- [MCP server](https://holofolder.com/app/mcp)

REST requires a personal API key. MCP uses OAuth. Documentation is public; API operations require the access and permissions described in the guides.
`
