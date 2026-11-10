import type { DeveloperPermission } from './permissions'
export type DeveloperPrincipal = {
  actorId: string
  credentialId: string
  transport: 'rest' | 'mcp'
  /** Verified OAuth identity for current-session rechecks, never a bearer token. */
  oauth?: { sessionId: string; clientId: string; expiresAt: number }
  permissions: readonly DeveloperPermission[]
}
export type OperationContext = {
  principal: DeveloperPrincipal
  ownerUserId: string
  memberIds: readonly string[]
  requestId: string
}
export type Page<T> = { data: T[]; nextCursor: string | null }
export type DeveloperKeyMetadata = {
  id: string; name: string; permissions: DeveloperPermission[]; created_at: string
  expires_at: string; revoked_at: string | null; last_used_at: string | null
}
