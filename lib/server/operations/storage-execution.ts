import "server-only"
import { requireExpectedAppearanceOwner } from "@/lib/server/binder-appearance"
import { randomUUID } from "node:crypto"
import { DeveloperAccessError, requirePermissions } from "@/lib/developer-api/permissions"
import type { OperationContext } from "@/lib/developer-api/types"
import { withAuditActor, withAuditOperation } from "@/lib/server/audit-context"
import { resolveCollectionMembership } from "@/lib/server/collection-owner"
import { requireDeveloperSettingsUser } from "@/lib/server/developer-access/first-party"
import { requireRestContext, requireMcpContext } from "@/lib/server/developer-access/principal"
import { readDeveloperJson } from "@/lib/server/developer-access/request"
import { parseStorageRequest, normalizeStorageResult, storageExecutionError, type StorageOperation } from "./storage-contract"

/** Internal only. #379 must wire gated app routes and the shared REST/MCP registry together. */
export async function executeAppStorageRequest(request: Request, operation: StorageOperation) {
  const { user } = await requireDeveloperSettingsUser(request, true)
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const client = createAdminClient()
  const membership = await resolveCollectionMembership(client, user.id)
  requireExpectedAppearanceOwner(request, membership.ownerUserId)
  const input = parseStorageRequest(operation, await readDeveloperJson(request, operation === "inventory" ? 8388608 : 1048576))
  return withAuditActor(user.id, () => executeStorageRpc(operation, membership.ownerUserId, input, client))
}

/** Authentication is shared with existing REST/MCP operations, including revocation, budgets and paid access. */
export async function executeRestStorageRequest(request: Request, operation: StorageOperation) {
  const context = await requireRestContext(request, STORAGE_PERMISSIONS, "write")
  return executeDeveloperStorageOperation(context, operation, await readDeveloperJson(request, operation === "inventory" ? 8388608 : 1048576))
}
export async function executeMcpStorageRequest(request: Request, operation: StorageOperation, input: unknown) {
  const context = await requireMcpContext(request, STORAGE_PERMISSIONS, "write")
  return executeDeveloperStorageOperation(context, operation, input)
}
// Slots can change wanted cards and release placements; every operation needs both write scopes.
const STORAGE_PERMISSIONS = ["collection:write", "binders:write"] as const

/** Same trusted-context contract as executeDeveloperOperation; never deserialize a context from HTTP or queues. */
export async function executeDeveloperStorageOperation(context: OperationContext, operation: StorageOperation, input: unknown) {
  requirePermissions(context.principal.permissions, STORAGE_PERMISSIONS)
  if (!["rest", "mcp"].includes(context.principal.transport)) throw new DeveloperAccessError("storage_access_denied", "Invalid storage transport.", 403)
  const parsed = parseStorageRequest(operation, input)
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return withAuditActor(context.principal.actorId, () => executeStorageRpc(operation, context.ownerUserId, parsed, createAdminClient()), context)
}

async function executeStorageRpc(operation: StorageOperation, ownerId: string, input: ReturnType<typeof parseStorageRequest>, client: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>) {
  const operationId = "operationId" in input ? String(input.operationId) : randomUUID()
  return withAuditOperation(operationId, async () => {
    const { data, error } = await client.rpc("storage_execute_v1", { operation, owner_id: ownerId, request: input }).abortSignal(AbortSignal.timeout(10000))
    if (error) throw storageExecutionError(error)
    return normalizeStorageResult(operation, data)
  })
}
