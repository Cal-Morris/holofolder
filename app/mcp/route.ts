import { connection } from 'next/server'
import { handleMcpRequest, mcpOptions } from '@/lib/server/mcp/http'
async function handle(request: Request) {
  await connection()
  return handleMcpRequest(request)
}
export { handle as POST, handle as GET, handle as DELETE, mcpOptions as OPTIONS }
