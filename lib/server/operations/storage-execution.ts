import { isRawRestoreReceipt as isBoundRawRestoreReceipt } from '@/lib/collection/raw-restore-delivery'
import { RAW_RESTORE_V2_LIMITS, isRawRestoreRejection, type RawRestoreCommand } from '@/lib/domain/raw-restore'
import { isCreationRejection, isImportRejection } from '@/lib/collection/creation-import-rejection'
import "server-only"
import { isRecoveryRejection } from "@/lib/collection/recovery-rejection"
import { isStorageCommandRejection } from "@/lib/collection/storage-command-rejection"
import { requireAppearanceOrigin, requireExpectedAppearanceOwner } from "@/lib/server/binder-appearance"
import { COLLECTION_CREATION_LIMITS } from "@/lib/domain/storage-creation"
import { randomUUID } from "node:crypto"
import { DeveloperAccessError, requirePermissions } from "@/lib/developer-api/permissions"
import type { OperationContext } from "@/lib/developer-api/types"
import { withAuditActor, withAuditOperation } from "@/lib/server/audit-context"
import { BillingAccessError } from "@/lib/billing"
import { readDeveloperJson } from "@/lib/server/developer-access/request"
import { parseStorageRequest, normalizeStorageResult, storageExecutionError, type StorageOperation } from "./storage-contract"

/** Trusted native executor shared by first-party and developer boundaries. */
export async function executeAppStorageRequest(request: Request, operation: StorageOperation, localClients?: {
  session: import("@supabase/supabase-js").SupabaseClient
  admin: import("@supabase/supabase-js").SupabaseClient
}) {
  requireAppearanceOrigin(request)
  // Trusted server injection only, used by the loopback-gated synthetic HTTP harness.
  // No request data can select these clients. Production uses the existing cookie/auth path.
  const session = localClients?.session ?? await (await import("@/lib/supabase/server")).createClient()
  // ES256 access token verified locally against the cached JWKS; the live-session check is the scope RPC below.
  const { data: verified, error: claimsError } = await session.auth.getClaims()
  const claims = verified?.claims
  if (claimsError || !claims?.sub || claims.client_id) throw new DeveloperAccessError("sign_in_required", "Sign in before retrying.", 401)
  const actorId = claims.sub
  const expectedActor = request.headers.get("X-Binder-Actor")
  if (expectedActor !== null && expectedActor !== actorId) throw new DeveloperAccessError("storage_session_changed", "The signed-in account changed.", 403)
  const expectedSession = request.headers.get("X-Binder-Auth-Session")
  if (!expectedSession) throw new DeveloperAccessError("storage_session_changed", "Use the current signed-in app session.", 403)
  if (claims.role !== "authenticated" || claims.session_id !== expectedSession) throw new DeveloperAccessError("storage_session_changed", "Sign in again before retrying this operation.", 403)
  const scope = await storageCallerScope(session, actorId, expectedSession)
  // A paused partner's command bound to the shared owner keeps its billing pause; it is never retargeted.
  if (scope.partnerPaused && request.headers.get("X-Binder-Owner") !== scope.owner) throw new BillingAccessError()
  requireExpectedAppearanceOwner(request, scope.owner)
  const input = parseStorageRequest(operation, await readDeveloperJson(request, storageRequestBytes(operation)))
  if (operation === 'backup.restore.raw') {
    const planning = (input as RawRestoreCommand).planning
    if (planning.authSessionId !== expectedSession || planning.actorUserId !== actorId
      || planning.ownerUserId !== scope.owner || planning.source !== 'app' || planning.credentialId !== null) {
      throw new DeveloperAccessError('storage_session_changed', 'Review restore in the original authenticated session.', 403)
    }
  }
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return withAuditActor(actorId, () => executeStorageRpc(operation, scope.owner, input, localClients?.admin ?? createAdminClient()))
}

/** One round trip as the signed-in user: inventory_read_scope_v2 (SECURITY DEFINER) requires a live, non-OAuth auth.sessions row
 * for this token's session and a user that is neither deleted nor banned, the checks Auth getUser made over HTTP, then resolves
 * the partnership owner with billing_partner_allowed (a paused partner gets their own collection, as storage_execute_v1 does). */
async function storageCallerScope(session: import("@supabase/supabase-js").SupabaseClient, actorId: string, sessionId: string) {
  const { data, error } = await session.rpc("inventory_read_scope_v2").abortSignal(AbortSignal.timeout(10000))
  if (error?.code === "42501" && error.message === "inventory_sign_in_required") throw new DeveloperAccessError("sign_in_required", "Sign in before retrying.", 401)
  if (error) throw storageExecutionError(error)
  if (data?.actor !== actorId || data.session_id !== sessionId || typeof data.owner !== "string" || typeof data.partner_paused !== "boolean") throw storageExecutionError(null)
  return { owner: data.owner as string, partnerPaused: data.partner_paused as boolean }
}

const storageRequestBytes = (operation: StorageOperation) => operation === "backup.restore.raw" ? RAW_RESTORE_V2_LIMITS.bytes : ["inventory", "backup.arrangement"].includes(operation) ? 8388608 : operation === "collection.create" ? COLLECTION_CREATION_LIMITS.bytes : 1048576
// Slots can change wanted cards and release placements; every operation needs both write scopes.
const STORAGE_PERMISSIONS = ["collection:write", "binders:write"] as const

/** Same trusted-context contract as executeDeveloperOperation; never deserialize a context from HTTP or queues. */
export async function executeDeveloperStorageOperation(context: OperationContext, operation: StorageOperation, input: unknown) {
  requirePermissions(context.principal.permissions, STORAGE_PERMISSIONS)
  if (!["rest", "mcp"].includes(context.principal.transport)) throw new DeveloperAccessError("storage_access_denied", "Invalid storage transport.", 403)
  const parsed = parseStorageRequest(operation, input)
  if (operation === 'backup.restore.raw') {
    const p = (parsed as RawRestoreCommand).planning
    if (p.actorUserId !== context.principal.actorId || p.ownerUserId !== context.ownerUserId
      || p.source !== context.principal.transport || p.credentialId !== context.principal.credentialId || p.authSessionId !== null) {
      throw new DeveloperAccessError('storage_access_denied', 'Review restore using the original authenticated credential and owner.', 403)
    }
  }
  const { createAdminClient } = await import("@/lib/supabase/admin")
  return withAuditActor(context.principal.actorId, () => executeStorageRpc(operation, context.ownerUserId, parsed, createAdminClient()), context)
}

async function executeStorageRpc(operation: StorageOperation, ownerId: string, input: ReturnType<typeof parseStorageRequest>, client: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>) {
  const operationId = "operationId" in input ? String(input.operationId) : randomUUID()
  return withAuditOperation(operationId, async () => {
    const { data, error } = await client.rpc("storage_execute_v1", { operation, owner_id: ownerId, request: input }).abortSignal(AbortSignal.timeout(10000))
    if (error) throw storageExecutionError(error)
    if ((operation === "slots" || operation === "inventory") && isStorageCommandRejection(data, operationId)) return { ...data }
    if ((operation === "recovery.apply" || operation === "recovery.apply.v2") && isRecoveryRejection(data, operationId)) return { ...data }
    if (operation === "backup.restore.raw" && isRawRestoreRejection(data, operationId)) return { ...data }
    if (operation === "collection.create" && isCreationRejection(data, operationId)) return { ...data }
    if (operation === "backup.arrangement" && isImportRejection(data, operationId)) return { ...data }
    // A malformed terminal row must never fall through to an accepted receipt projection.
    if (data && typeof data === "object" && "outcome" in data) throw storageExecutionError(null)
    if (operation === 'backup.restore.raw' && !isBoundRawRestoreReceipt(data, input as RawRestoreCommand)) throw storageExecutionError(null)
    return normalizeStorageResult(operation, data)
  })
}

export async function checkedLocalStorageUser(request: Request, client: import("@supabase/supabase-js").SupabaseClient) {
  const { requireAppearanceOrigin } = await import("@/lib/server/binder-appearance")
  requireAppearanceOrigin(request)
  const claims = await client.auth.getClaims(), result = await client.auth.getUser()
  if (claims.error || result.error || !result.data.user || claims.data?.claims.sub !== result.data.user.id
    || claims.data.claims.client_id) throw new DeveloperAccessError("sign_in_required", "Sign in before retrying.", 401)
  return { user: result.data.user, client }
}
