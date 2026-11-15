import { MAX_BINDERS_PER_OWNER } from '@/lib/binders/model';

export const BILLING_PRICES = { month: 399, year: 3499 } as const;
/** One-time Lifetime price in pence, sold through Checkout payment mode on its own Stripe product. */
export const BILLING_LIFETIME_PRICE = 7900;
export type BillingPlan = keyof typeof BILLING_PRICES | 'lifetime';
export const BILLING_ANNUAL_SAVING = BILLING_PRICES.month * 12 - BILLING_PRICES.year;
/**
 * Launch offer approved 15 Nov 2026: half off the first payment period, applied at Checkout by a server-side coupon.
 * It switches off by itself at the end date, after which the normal prices above apply again. Amounts are exact
 * pence (amount_off coupons) so Checkout charges what the app shows. Coupons exist with these IDs in live and test.
 */
export const LAUNCH_OFFER = {
  // 31 Dec 2026 23:59:59 Europe/London (GMT, so UTC+0).
  endsAt: Date.parse('2026-12-31T23:59:59Z'),
  endLabel: '31 December 2026',
  price: { month: 200, year: 1750, lifetime: 3950 },
  monthlyMonths: 3,
  coupon: {
    month: 'holofolder-launch-2026-month',
    year: 'holofolder-launch-2026-year',
    lifetime: 'holofolder-launch-2026-lifetime',
  },
} as const;
export const launchOfferActive = (now = Date.now()) => now <= LAUNCH_OFFER.endsAt;
/**
 * The coupon a new Checkout gets. Stripe takes either a discount or the promotion code box, never both, so a
 * customer with a creator or audience code gets the code box and no launch coupon. Annual has no code box.
 */
export function launchOfferCoupon(plan: BillingPlan, wantsPromotionCode: boolean, now = Date.now()) {
  if (!launchOfferActive(now) || (wantsPromotionCode && plan !== 'year')) return null;
  return LAUNCH_OFFER.coupon[plan];
}
/** The single wording used everywhere in the app for each plan while the offer runs. */
export function launchOfferText(plan: BillingPlan) {
  const offer = billingAmount(LAUNCH_OFFER.price[plan]);
  if (plan === 'year')
    return `Launch offer: ${offer} for your first year, then ${billingAmount(BILLING_PRICES.year)} a year`;
  if (plan === 'month')
    return `Launch offer: ${offer} a month for ${LAUNCH_OFFER.monthlyMonths} months, then ${billingAmount(BILLING_PRICES.month)} a month`;
  return `Launch offer: ${offer} until 31 December, then £${BILLING_LIFETIME_PRICE / 100}`;
}
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
