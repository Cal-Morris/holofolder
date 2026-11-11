import { docsLLMs } from '@/lib/docs-llms';
import { docsSource } from '@/lib/docs-source';

export async function generateStaticParams() {
  return (await docsSource).generateParams();
}

export async function GET(_request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const page = (await docsSource).getPage((await params).slug);
  if (!page)
    return new Response('Documentation page not found\n', {
      status: 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  return new Response(await docsLLMs.page(page), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
