import { installAuditHeaderReader } from "@/lib/supabase/audit-header"
import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import type { OperationContext } from "@/lib/developer-api/types"

// Context is established after authentication, never from request headers/body or queued actor fields.
const attribution = new AsyncLocalStorage<{ actor: {kind:"user";userId:string} | {kind:"system";job:string}; source: "app" | "rest" | "mcp" | "system"; clientId: string | null; batchId: string }>()
export function withAuditActor<T>(actorId: string, run: () => T, context?: OperationContext): T {
  return attribution.run({ actor: {kind:"user",userId:actorId}, source: context?.principal.transport ?? "app", clientId: context?.principal.credentialId ?? null,
    batchId: context?.requestId ?? randomUUID() }, run)
}

/** Each PostgREST request is one database transaction. Preserve the enclosing intent as batchId.
 * Only the service-key client's fetch calls this; ordinary user headers cannot become trusted context. */
export function auditContextHeader(): string | undefined {
  const context = attribution.getStore()
  if (!context) return undefined
  return JSON.stringify({ actor: context.actor, source: context.source, clientId: context.clientId,
    operationId: randomUUID(), batchId: context.batchId, clientOccurredAt: null })
}

/** Future service jobs opt in explicitly at their authenticated server entry point. Unwrapped jobs remain Unknown. */
export function withAuditSystem<T>(job: string, run: () => T): T {
  if (!/^[a-z][a-z0-9_-]{0,79}$/.test(job)) throw new Error("Invalid audit job identifier")
  return attribution.run({actor:{kind:"system",job},source:"system",clientId:null,batchId:randomUUID()},run)
}

installAuditHeaderReader(auditContextHeader)
