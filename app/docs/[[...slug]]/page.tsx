import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import dynamic from 'next/dynamic';
import { DocsLink } from '@/components/docs/provider';
import { docsMarkdownHref } from '@/lib/docs-markdown';
import { docsSource } from '@/lib/docs-source';
import { docsCanonicalUrl } from '@/lib/docs-routing';

const OpenAPIPage = dynamic(() => import('@/components/docs/api-page').then((module) => module.OpenAPIPage), {
  loading: () => <p className="text-fd-muted-foreground text-sm">Loading API explorer…</p>,
});

export async function generateStaticParams() {
  return (await docsSource).generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = (await docsSource).getPage(slug);
  return page
    ? {
        title: page.data.title,
        description: page.data.description,
        alternates: { canonical: docsCanonicalUrl(page.url), types: { 'text/markdown': docsMarkdownHref(page.url) } },
      }
    : {};
}

export default async function DocumentationPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = (await docsSource).getPage(slug);
  if (!page) notFound();
  const isAPI = page.type === 'openapi';
  return (
    <DocsPage
      toc={page.data.toc}
      full={isAPI}
      tableOfContent={{ enabled: !isAPI }}
      tableOfContentPopover={{ enabled: !isAPI }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      {!isAPI && <DocsDescription>{page.data.description}</DocsDescription>}
      <div className="text-fd-muted-foreground mb-6 flex flex-wrap items-center gap-4 text-xs">
        <DocsLink
          className="hover:text-fd-foreground inline-flex min-h-9 items-center"
          href={`/app/docs/markdown${slug?.length ? `/${slug.join('/')}` : ''}`}
        >
          View as Markdown
        </DocsLink>
        <DocsLink className="hover:text-fd-foreground inline-flex min-h-9 items-center" href="/app/docs/llms.txt">
          llms.txt
        </DocsLink>
      </div>
      <DocsBody>
        {isAPI ? (
          <OpenAPIPage {...page.data.getOpenAPIPageProps()} />
        ) : (
          <page.data.body components={defaultMdxComponents} />
        )}
      </DocsBody>
    </DocsPage>
  );
}
