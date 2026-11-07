import type { CollectedPokemon } from '@/lib/domain/cards'

export interface PushMembership {
  actorId: string
  ownerId: string
  partnershipId: string
  recipientId: string
}
export interface AcquisitionIntent {
  operationId: string
  actorId: string
  partnershipId: string
  recipientId: string
  printingKey: string
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function ownedPrintingKey(item: CollectedPokemon | null | undefined) {
  return item?.card_id && item.status !== 'wishlisted' ? `${item.card_id}:${item.card_language ?? 'en'}:${item.card_finish ?? 'normal'}` : null
}
export function normalizeAcquisition(value: unknown): AcquisitionIntent | undefined {
  const row = record(value)
  if (!row || !uuid(row.operationId) || !uuid(row.actorId) || !uuid(row.partnershipId) || !uuid(row.recipientId)
    || row.actorId === row.recipientId || typeof row.printingKey !== 'string' || !row.printingKey || row.printingKey.length > 512) return undefined
  return { operationId: row.operationId, actorId: row.actorId, partnershipId: row.partnershipId, recipientId: row.recipientId, printingKey: row.printingKey }
}
export function captureAcquisition(before: CollectedPokemon | null, after: CollectedPokemon, context: { actorId: string; ownerId: string | null; membership: PushMembership | null }, operationId?: string) {
  const key = ownedPrintingKey(after), member = context.membership
  if (!key || key === ownedPrintingKey(before) || !member || member.actorId !== context.actorId || member.ownerId !== context.ownerId) return undefined
  return normalizeAcquisition({ operationId: operationId ?? (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : undefined), actorId: context.actorId, partnershipId: member.partnershipId, recipientId: member.recipientId, printingKey: key })
}
export function mergeQueuedAcquisition(base: CollectedPokemon | null | undefined, next: CollectedPokemon | null, given: AcquisitionIntent | undefined, previous: AcquisitionIntent | undefined) {
  const key = ownedPrintingKey(next)
  if (!key || key === ownedPrintingKey(base)) return undefined
  return given?.printingKey === key ? given : previous?.printingKey === key ? previous : undefined
}

type MembershipStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const membershipKey = (actorId: string) => `binderdex:push-membership:v1:${actorId}`
export function readPushMembership(actorId: string, storage?: MembershipStorage): PushMembership | null {
  try {
    const row = record(JSON.parse((storage ?? window.localStorage).getItem(membershipKey(actorId)) ?? 'null'))
    if (!row || row.actorId !== actorId || !uuid(row.ownerId) || !uuid(row.partnershipId) || !uuid(row.recipientId) || row.recipientId === actorId) return null
    return { actorId, ownerId: row.ownerId, partnershipId: row.partnershipId, recipientId: row.recipientId }
  } catch { return null }
}
export function writePushMembership(actorId: string, membership: PushMembership | null, storage?: MembershipStorage) {
  try {
    const target = storage ?? window.localStorage
    if (membership) target.setItem(membershipKey(actorId), JSON.stringify(membership))
    else target.removeItem(membershipKey(actorId))
  } catch { /* Membership caching must never prevent a collection edit. */ }
}

function decodeKey(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(value)) return null
  try { return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)) } catch { return null }
}
export function normalizePushSubscription(value: unknown) {
  const row = record(value), keys = record(row?.keys)
  if (!row || typeof row.endpoint !== 'string' || row.endpoint.length > 2048 || !keys) return null
  try {
    const url = new URL(row.endpoint)
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'].includes(url.hostname)
      || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com')
    if (!allowed || url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname.length < 2) return null
  } catch { return null }
  const p256dh = decodeKey(keys.p256dh), auth = decodeKey(keys.auth)
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 4 || !auth || auth.length !== 16) return null
  const label = typeof row.label === 'string' ? row.label.trim() : 'This device'
  if (label.length > 80) return null
  return { endpoint: row.endpoint, p256dh: String(keys.p256dh), auth: String(keys.auth), label: label || 'This device' }
}
