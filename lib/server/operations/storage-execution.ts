import "server-only"
import { isStorageCommandRejection } from "@/lib/collection/storage-command-rejection"
import { requireExpectedAppearanceOwner } from "@/lib/server/binder-appearance"
import { COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
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
export async function executeAppStorageRequest(request: Request, operation: StorageOperation, localClients?: {
  session: import("@supabase/supabase-js").SupabaseClient
  admin: import("@supabase/supabase-js").SupabaseClient
}) {
  // Trusted server injection only, used by the loopback-gated synthetic HTTP harness.
  // No request data can select these clients. Production uses the existing cookie/auth path.
  const { user, client: session } = localClients
    ? await checkedLocalStorageUser(request, localClients.session)
    : await requireDeveloperSettingsUser(request, true)
  const expectedSession = request.headers.get("X-Binder-Auth-Session")
  if (expectedSession !== null) {
    const claims = await session.auth.getClaims()
    if (claims.error || claims.data?.claims.role !== "authenticated" || claims.data.claims.sub !== user.id || claims.data.claims.client_id
      || claims.data.claims.session_id !== expectedSession) throw new DeveloperAccessError("storage_session_changed", "Sign in again before retrying this operation.", 403)
  }
  const { createAdminClient } = await import("@/lib/supabase/admin")
  const client = localClients?.admin ?? createAdminClient()
  const membership = await resolveCollectionMembership(client, user.id)
  requireExpectedAppearanceOwner(request, membership.ownerUserId)
  const input = parseStorageRequest(operation, await readDeveloperJson(request, storageRequestBytes(operation)))
  return withAuditActor(user.id, () => executeStorageRpc(operation, membership.ownerUserId, input, client))
}

/** Authentication is shared with existing REST/MCP operations, including revocation, budgets and paid access. */
export async function executeRestStorageRequest(request: Request, operation: StorageOperation) {
  const context = await requireRestContext(request, STORAGE_PERMISSIONS, "write")
  return executeDeveloperStorageOperation(context, operation, await readDeveloperJson(request, storageRequestBytes(operation)))
}
export async function executeMcpStorageRequest(request: Request, operation: StorageOperation, input: unknown) {
  const context = await requireMcpContext(request, STORAGE_PERMISSIONS, "write")
  return executeDeveloperStorageOperation(context, operation, input)
}
const storageRequestBytes = (operation: StorageOperation) => ["inventory", "backup.arrangement"].includes(operation) ? 8388608 : operation === "collection.create" ? COLLECTION_CREATION_LIMITS.bytes : 1048576
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
    if ((operation === "slots" || operation === "inventory") && isStorageCommandRejection(data, operationId)) return { ...data }
    return normalizeStorageResult(operation, data)
  })
}

async function checkedLocalStorageUser(request: Request, client: import("@supabase/supabase-js").SupabaseClient) {
  const { requireAppearanceOrigin } = await import("@/lib/server/binder-appearance")
  requireAppearanceOrigin(request)
  const claims = await client.auth.getClaims(), result = await client.auth.getUser()
  if (claims.error || result.error || !result.data.user || claims.data?.claims.sub !== result.data.user.id
    || claims.data.claims.client_id) throw new DeveloperAccessError("sign_in_required", "Sign in before retrying.", 401)
  return { user: result.data.user, client }
}
