import { MAX_BINDERS_PER_OWNER } from '@/lib/binders/model';

export const BILLING_PRICES = { month: 399, year: 3499 } as const;
export const BILLING_ANNUAL_SAVING = BILLING_PRICES.month * 12 - BILLING_PRICES.year;
/** `free_card_limit` value meaning the free plan has no saved-entry cap (migration 129). */
export const UNLIMITED_FREE_CARD_LIMIT = 2_147_483_647;
export const billingAmount = (pence: number) => `£${(pence / 100).toFixed(2)}`;

export interface BillingAccess {
  ownerUserId: string;
  tier: 'free' | 'paid';
  source: 'free' | 'subscription' | 'perpetual' | 'trial' | 'grant';
  paidThrough: string | null;
  trialEndsAt: string | null;
  /** End of the Premium time granted by invite rewards (migration 133), chained after the trial. */
  grantedUntil: string | null;
  /** This owner signed up through an invite that has not been rewarded yet. */
  referralPending: boolean;
  savedCardCount: number;
  cardLimit: number | null;
  freeCardLimit: number;
  freeBinderLimit: number;
  binderLimit: number;
  enforced: boolean;
}

export function resolveBillingAccess(
  ownerUserId: string,
  row: Record<string, unknown> = {},
  now = Date.now(),
): BillingAccess {
  // Older servers/caches still enforce ten entries and have no free binder cap.
  const positiveInteger = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback;
  const freeCardLimit = positiveInteger(row.free_card_limit, 10);
  const freeBinderLimit = Math.min(
    MAX_BINDERS_PER_OWNER,
    positiveInteger(row.free_binder_limit, MAX_BINDERS_PER_OWNER),
  );
  const paidThrough =
    typeof row.paid_through === 'string' && Number.isFinite(Date.parse(row.paid_through)) ? row.paid_through : null;
  const time = (value: unknown) => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
  const trialEndsAt = time(row.trial_ends_at);
  const grantedUntil = time(row.granted_until);
  const source =
    row.perpetual === true
      ? 'perpetual'
      : ['active', 'past_due'].includes(String(row.status)) && paidThrough && Date.parse(paidThrough) > now
        ? 'subscription'
        : trialEndsAt && Date.parse(trialEndsAt) > now
          ? 'trial'
          : grantedUntil && Date.parse(grantedUntil) > now
            ? 'grant'
            : 'free';
  return {
    ownerUserId,
    tier: source === 'free' ? 'free' : 'paid',
    source,
    paidThrough,
    trialEndsAt,
    grantedUntil,
    referralPending: row.referral_pending === true,
    savedCardCount: typeof row.saved_card_count === 'number' && row.saved_card_count >= 0 ? row.saved_card_count : 0,
    cardLimit: source === 'free' && freeCardLimit < UNLIMITED_FREE_CARD_LIMIT ? freeCardLimit : null,
    freeCardLimit,
    freeBinderLimit,
    binderLimit: source === 'free' && row.enforced === true ? freeBinderLimit : MAX_BINDERS_PER_OWNER,
    enforced: row.enforced === true,
  };
}
/** The `get_billing_access` row an access was resolved from, so caches re-resolve it against a later clock. */
export function billingAccessRow(access: BillingAccess) {
  return {
    enforced: access.enforced,
    perpetual: access.source === 'perpetual',
    status: access.source === 'subscription' ? 'active' : 'none',
    paid_through: access.paidThrough,
    trial_ends_at: access.trialEndsAt,
    granted_until: access.grantedUntil,
    saved_card_count: access.savedCardCount,
    free_card_limit: access.freeCardLimit,
    free_binder_limit: access.freeBinderLimit,
  };
}
/**
 * Whether Premium-only views (price trends, analytics, deal checks, page scanning) are unlocked. Only a loaded
 * free plan locks them: guests get the full demo (new accounts start on a Premium trial) and paid owners see no
 * flash of upsells while billing loads.
 */
export function hasPremiumFeatures(access: BillingAccess | null) {
  return !access || !access.enforced || access.tier === 'paid';
}
export function canCreateOwnerBinder(access: BillingAccess, binderCount: number) {
  return binderCount < access.binderLimit;
}
export class BillingAccessError extends Error {
  readonly status = 402;
  constructor(public code: 'upgrade_required' | 'card_limit_reached' | 'binder_limit_reached' = 'upgrade_required') {
    super(
      code === 'card_limit_reached'
        ? 'You have reached your free entry allowance. Upgrade to save more. Your changes are kept on this device.'
        : code === 'binder_limit_reached'
          ? 'Your free plan includes one binder. Upgrade to create more binders.'
          : 'Upgrade to Holo Folder for more binders, partner mode, price comparisons and trends, analytics, deal checks and page scanning.',
    );
  }
}
export function isBillingError(error: unknown): boolean {
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown } | null;
  return (
    candidate?.status === 402 ||
    ['upgrade_required', 'card_limit_reached', 'binder_limit_reached'].includes(String(candidate?.code)) ||
    /upgrade_required|card_limit_reached|binder_limit_reached/.test(String(candidate?.message ?? ''))
  );
}
