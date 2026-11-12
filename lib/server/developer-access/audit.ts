import type { OperationContext } from '@/lib/developer-api/types';
import { trackApiRequest } from '@/lib/server/google-analytics';
export function auditDeveloperOperation(
  context: Pick<OperationContext, 'principal' | 'requestId'>,
  operation: string,
  outcome: 'success' | 'failure',
  code?: string,
) {
  // Platform log retention applies. Never include arguments, credentials or returned data.
  console.info(
    JSON.stringify({
      event: 'developer_operation',
      actorId: context.principal.actorId,
      credentialId: context.principal.credentialId,
      transport: context.principal.transport,
      operation,
      outcome,
      code,
      requestId: context.requestId,
    }),
  );
  trackApiRequest(context.principal.credentialId, {
    transport: context.principal.transport,
    operation,
    outcome,
    code,
  });
}
