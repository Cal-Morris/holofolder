import { agentDocsLinks, docsLLMs } from '@/lib/docs-llms';

export async function GET() {
  return new Response(`# Holo Folder developer documentation\n\n${agentDocsLinks}\n${await docsLLMs.full()}`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
