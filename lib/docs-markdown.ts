import schema from '@/public/openapi.json'

const ORIGIN = 'https://holofolder.com'

export function docsMarkdownHref(href: string): string {
  if (/^\/docs(?:[\/#]|$)/.test(href)) return `${ORIGIN}${href.replace(/^\/docs/, '/app/docs/markdown')}`
  return href.startsWith('/') ? `${ORIGIN}${href}` : href
}

export function rewriteDocsLinks(markdown: string): string {
  return markdown.replace(/\]\((\/[^\s)]*)\)/g, (_, href: string) => `](${docsMarkdownHref(href)})`)
}

export function formatEndpointMarkdown({ title, url, method, path, operation }: {
  title: string; url: string; method: string; path: string; operation: unknown
}): string {
  return `# ${title}\n\nSource: ${ORIGIN}/app${url}\n\n${method.toUpperCase()} ${schema.servers[0].url}${path}\n\nOpenAPI operation (parameters, authentication, request body and responses):\n\n\`\`\`json\n${JSON.stringify(operation, null, 2)}\n\`\`\`\n`
}
