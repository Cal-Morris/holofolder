import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { docsSource } from '@/lib/docs-source'
export function generateStaticParams() { return docsSource.generateParams() }
export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  return page ? { title: page.data.title, description: page.data.description, alternates: { canonical: `https://holofolder.com${page.url}` } } : {}
}
export default async function DocumentationPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = docsSource.getPage(slug)
  if (!page) notFound()
  const Content = page.data.body
  return <DocsPage toc={page.data.toc} tableOfContent={{ enabled: false }} tableOfContentPopover={{ enabled: false }}>
    <DocsTitle>{page.data.title}</DocsTitle><DocsDescription>{page.data.description}</DocsDescription>
    <DocsBody><Content components={defaultMdxComponents} /></DocsBody>
  </DocsPage>
}
