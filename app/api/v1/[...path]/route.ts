import { connection } from 'next/server';
import { handleRestRequest } from '@/lib/server/developer-access/http';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  await connection();
  return handleRestRequest(request, context);
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };

export { restOptions as OPTIONS } from '@/lib/server/developer-access/request';
