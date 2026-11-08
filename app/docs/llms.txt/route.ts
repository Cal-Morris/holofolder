import { agentDocsLinks, docsLLMs } from '@/lib/docs-llms'

export async function GET() {
  return new Response(`${await docsLLMs.index()}\n\n${agentDocsLinks}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  })
}
