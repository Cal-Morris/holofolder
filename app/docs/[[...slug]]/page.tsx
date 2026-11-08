import { notFound } from 'next/navigation'
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page'
import defaultMdxComponents from 'fumadocs-ui/mdx'
import dynamic from 'next/dynamic'
import { docsSource } from '@/lib/docs-source'

const OpenAPIPage = dynamic(() => import('@/components/docs/api-page').then(module => module.OpenAPIPage), {
  loading: () => <p className="text-sm text-fd-muted-foreground">Loading API explorer…</p>,
})

export async function generateStaticParams() { return (await docsSource).generateParams() }

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = (await docsSource).getPage(slug)
  return page ? { title: page.data.title, description: page.data.description, alternates: { canonical: `https://holofolder.com${page.url}` } } : {}
}

export default async function DocumentationPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params
  const page = (await docsSource).getPage(slug)
  if (!page) notFound()
  const isAPI = page.type === 'openapi'
  return <DocsPage toc={page.data.toc} full={isAPI} tableOfContent={{ enabled: !isAPI }} tableOfContentPopover={{ enabled: !isAPI }}>
    <DocsTitle>{page.data.title}</DocsTitle>
    {!isAPI && <DocsDescription>{page.data.description}</DocsDescription>}
    <DocsBody>{isAPI ? <OpenAPIPage {...page.data.getOpenAPIPageProps()} /> : <page.data.body components={defaultMdxComponents} />}</DocsBody>
  </DocsPage>
}
