import { notFound } from 'next/navigation';
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { helpSource } from '@/lib/help-source';
import { docsCanonicalUrl } from '@/lib/docs-routing';

export function generateStaticParams() {
  return helpSource.generateParams();
}

export async function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = helpSource.getPage(slug);
  return page
    ? {
        title: page.data.title,
        description: page.data.description,
        alternates: { canonical: docsCanonicalUrl(page.url) },
      }
    : {};
}

export default async function HelpPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = helpSource.getPage(slug);
  if (!page) notFound();
  return (
    <DocsPage toc={page.data.toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <page.data.body components={defaultMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}
