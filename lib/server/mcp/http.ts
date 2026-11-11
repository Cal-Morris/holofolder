import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { verifyMcpToken } from '@/lib/server/developer-access/grants';
import { requireMcpContext } from '@/lib/server/developer-access/principal';
import {
  bearerCredential,
  DEVELOPER_HEADERS,
  developerErrorResponse,
  readDeveloperJson,
} from '@/lib/server/developer-access/request';
import { createHoloMcpServer } from '@/lib/server/mcp/server';
import { MCP_METADATA_URL } from '@/lib/server/mcp/metadata';
import { DEVELOPER_OPERATIONS } from '@/lib/developer-api/operations';
export async function handleMcpRequest(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const token = bearerCredential(request);
    if (!token || token.startsWith('hf_'))
      throw new DeveloperAccessError('oauth_required', 'Connect through OAuth. API keys are only for REST.', 401);
    // Signature, issuer, audience and expiry are checked locally before the body is read; everything else is one RPC below.
    const identity = await verifyMcpToken(token);
    // The largest native intent is bounded at 8 MiB; reserve 64 KiB for JSON-RPC framing.
    let bodyBytes = 0;
    const body =
      request.method === 'POST'
        ? await readDeveloperJson(request, 8388608 + 65536, (size) => {
            bodyBytes = size;
          })
        : undefined;
    const toolParams = body?.params as { name?: unknown } | undefined;
    const operation =
      body?.method === 'tools/call' ? DEVELOPER_OPERATIONS.find((op) => op.name === toolParams?.name) : undefined;
    if (body && bodyBytes > (operation?.maxBytes ? operation.maxBytes + 65536 : 131072))
      throw new DeveloperAccessError('body_too_large', 'The MCP request exceeds this operation’s body limit.', 413);
    // One authentication per HTTP request; a body is one JSON-RPC message, so at most one tool call shares it.
    const context = await requireMcpContext(identity, request, operation?.write ? 'write' : 'read', requestId);
    const server = createHoloMcpServer(context);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(request, { parsedBody: body });
      for (const [key, value] of Object.entries(DEVELOPER_HEADERS)) response.headers.set(key, value);
      response.headers.set('X-Request-Id', requestId);
      response.headers.set('Access-Control-Allow-Origin', '*');
      response.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, X-Request-Id');
      return response;
    } finally {
      await server.close();
    }
  } catch (error) {
    const response = developerErrorResponse(error, requestId);
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, MCP-Protocol-Version, X-Request-Id');
    if (response.status === 401)
      response.headers.set('WWW-Authenticate', `Bearer resource_metadata="${MCP_METADATA_URL}"`);
    return response;
  }
}
export function mcpOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers':
        'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id, Last-Event-ID',
      'Access-Control-Max-Age': '600',
    },
  });
}
