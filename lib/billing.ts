export const FREE_CARD_LIMIT = 10
export const BILLING_PRICES = { month: 299, year: 2999 } as const

export interface BillingAccess {
  ownerUserId: string
  tier: 'free' | 'paid'
  source: 'free' | 'subscription' | 'perpetual'
  paidThrough: string | null
  savedCardCount: number
  cardLimit: number | null
  enforced: boolean
}

export function savedCardWeight(item: { status?: unknown; wanted_cards?: unknown }) {
  const wants = Array.isArray(item.wanted_cards) ? item.wanted_cards.length : 0
  return item.status === 'wishlisted' ? Math.max(1, wants) : 1 + wants
}
export function countSavedCards(items: Array<{ status?: unknown; wanted_cards?: unknown }>) {
  return items.reduce((sum, item) => sum + savedCardWeight(item), 0)
}
export function resolveBillingAccess(ownerUserId: string, row: Record<string, unknown> = {}, now = Date.now()): BillingAccess {
  const paidThrough = typeof row.paid_through === 'string' && Number.isFinite(Date.parse(row.paid_through)) ? row.paid_through : null
  const source = row.perpetual === true ? 'perpetual'
    : ['active', 'past_due'].includes(String(row.status)) && paidThrough && Date.parse(paidThrough) > now ? 'subscription' : 'free'
  return { ownerUserId, tier: source === 'free' ? 'free' : 'paid', source, paidThrough,
    savedCardCount: typeof row.saved_card_count === 'number' && row.saved_card_count >= 0 ? row.saved_card_count : 0,
    cardLimit: source === 'free' ? FREE_CARD_LIMIT : null, enforced: row.enforced === true }
}
export function canGrowCollection(access: BillingAccess, previousCount: number, nextCount: number) {
  return !access.enforced || access.tier === 'paid' || nextCount <= FREE_CARD_LIMIT || nextCount <= previousCount
}
export class BillingAccessError extends Error {
  readonly status = 402
  constructor(public code: 'upgrade_required' | 'card_limit_reached' = 'upgrade_required') {
    super(code === 'card_limit_reached' ? 'Your free account holds 10 cards. Upgrade to save more. Your changes are kept on this device.' : 'Upgrade to Holo Folder for sharing, partner mode and price comparisons.')
  }
}
export function isBillingError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null
  return candidate?.status === 402 || ['upgrade_required', 'card_limit_reached'].includes(String(candidate?.code))
    || /upgrade_required|card_limit_reached/.test(String(candidate?.message ?? ''))
}

export function pendingCardDelta(operations: Array<{ type: string; base?: { status?: unknown; wanted_cards?: unknown } | null; item?: { status?: unknown; wanted_cards?: unknown } }>) {
  return operations.reduce((sum, operation) => sum + (operation.type === 'upsert' && operation.item ? savedCardWeight(operation.item) : 0) - (operation.base ? savedCardWeight(operation.base) : 0), 0)
}
