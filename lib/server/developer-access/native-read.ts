import "server-only"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { OperationContext } from "@/lib/developer-api/types"
import { DeveloperAccessError, developerEntitled, normalizePermissions, requirePermissions } from "@/lib/developer-api/permissions"
import { resolveBillingAccess } from "@/lib/billing"
import type { InventoryReadAuthority } from "@/lib/server/inventory-read-core"

export const NATIVE_READ_PERMISSIONS = ["collection:read", "binders:read"] as const
const denied = (): never => { throw new DeveloperAccessError("native_read_forbidden", "Current credential or collection access changed. Authenticate and read again.", 403) }
const unavailable = (): never => { throw new DeveloperAccessError("native_read_unavailable", "Native reads are temporarily unavailable.", 503) }

/** Rechecks current credential, actor, membership and billing before any owner data and at final fences.
 * The context comes from the existing authenticator, never the request body or a browser session. */
export function developerReadAuthority(db: SupabaseClient, context: OperationContext): InventoryReadAuthority {
  return { privateSettings: true, scope: async (check, signal) => {
    const p = context.principal
    requirePermissions(p.permissions, NATIVE_READ_PERMISSIONS)
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (![p.actorId, p.credentialId, context.ownerUserId, ...context.memberIds].every(id => uuid.test(id))) return denied()
    check()
    let permissions: unknown
    if (p.transport === "rest") {
      const result = await db.from("developer_api_keys").select("id,actor_id,permissions,expires_at,revoked_at")
        .eq("id", p.credentialId).abortSignal(signal).maybeSingle()
      if (result.error) return unavailable()
      const key = result.data
      if (!key || key.id !== p.credentialId || key.actor_id !== p.actorId || key.revoked_at
        || !Number.isFinite(Date.parse(key.expires_at)) || Date.parse(key.expires_at) <= Date.now()) return denied()
      permissions = key.permissions
    } else if (p.transport === "mcp") {
      if (!p.oauth || !uuid.test(p.oauth.sessionId) || !uuid.test(p.oauth.clientId) || p.oauth.expiresAt <= Date.now() / 1000 || !Number.isFinite(p.oauth.expiresAt)) return denied()
      const result = await db.rpc("verify_developer_oauth_session", { session: p.oauth.sessionId, actor: p.actorId,
        client: p.oauth.clientId, grant_version: p.credentialId }).abortSignal(signal)
      if (result.error) return unavailable()
      if (!result.data || result.data.id !== p.credentialId) return denied()
      permissions = result.data.permissions
    } else return denied()
    const current = normalizePermissions(permissions)
    requirePermissions(current, NATIVE_READ_PERMISSIONS)
    if (JSON.stringify(current.toSorted()) !== JSON.stringify([...p.permissions].toSorted())) return denied()
    check()
    const user = await db.auth.admin.getUserById(p.actorId)
    if (user.error || !user.data.user || user.data.user.id !== p.actorId || user.data.user.deleted_at
      || user.data.user.banned_until && Date.parse(user.data.user.banned_until) > Date.now()) return denied()
    check()
    const membership = await db.from("partnerships").select("id,owner_user_id,user1_id,user2_id")
      .or(`user1_id.eq.${p.actorId},user2_id.eq.${p.actorId}`).limit(2).abortSignal(signal)
    if (membership.error || !Array.isArray(membership.data) || membership.data.length > 1) return unavailable()
    const partnership = membership.data[0] ?? null
    if (partnership && (![partnership.user1_id, partnership.user2_id].includes(p.actorId)
      || ![partnership.user1_id, partnership.user2_id].includes(partnership.owner_user_id))) return denied()
    const owner = partnership?.owner_user_id ?? p.actorId
    const members = partnership ? [partnership.user1_id, partnership.user2_id] : [p.actorId]
    if (owner !== context.ownerUserId || JSON.stringify([...new Set(members)].sort()) !== JSON.stringify([...context.memberIds].sort())) return denied()
    check()
    const allowed = await db.rpc("billing_partner_allowed", { owner_id: owner, actor_id: p.actorId }).abortSignal(signal)
    if (allowed.error || typeof allowed.data !== "boolean") return unavailable()
    if (!allowed.data) return denied()
    check()
    const billing = await db.rpc("resolve_developer_access", { actor: p.actorId, request_kind: null }).abortSignal(signal)
    if (billing.error || !billing.data?.billing_access || !Array.isArray(billing.data.member_ids)) return unavailable()
    if (billing.data.owner_user_id !== owner
      || JSON.stringify([...billing.data.member_ids].sort()) !== JSON.stringify([...members].sort())) return denied()
    if (!developerEntitled(resolveBillingAccess(owner, billing.data.billing_access))) throw new DeveloperAccessError("premium_required", "Native developer reads require Premium or lifetime access.", 402)
    return { actor: p.actorId, owner, authorityId: `${p.transport}:${p.credentialId}`, partnership }
  } }
}
