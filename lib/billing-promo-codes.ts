/**
 * Rules for operator-vended Stripe promotion codes (scripts/promo-code.ts). Coupons can only be limited by product,
 * so each plan maps to the product that holds its price. Annual is not offered: annual Checkout has no code box,
 * which is what keeps monthly-scoped coupons off the annual price (both live on the Premium product).
 */
export const PROMO_PLANS = {
  lifetime: { lookupKey: 'holofolder_gbp_lifetime_v1', label: 'Lifetime (£79 once)' },
  monthly: { lookupKey: 'holofolder_gbp_month_v2', label: 'Monthly (£3.99)' },
} as const;
export type PromoPlan = keyof typeof PROMO_PLANS;

export interface PromoCodeRequest {
  plan: PromoPlan;
  code: string;
  percentOff?: number;
  amountOff?: number;
  duration: 'once' | 'forever' | 'repeating';
  months?: number;
  maxUses?: number;
  firstTime: boolean;
  expiresAt?: number;
  creator?: string;
}

export function parsePromoCodeRequest(values: Record<string, string | boolean | undefined>): PromoCodeRequest {
  const str = (key: string) => (typeof values[key] === 'string' ? (values[key] as string).trim() : undefined);
  const int = (key: string) => {
    const raw = str(key);
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`--${key} must be a positive whole number`);
    return n;
  };
  const plan = str('plan');
  if (plan !== 'lifetime' && plan !== 'monthly') throw new Error('--plan must be lifetime or monthly');
  const code = str('code')?.toUpperCase();
  if (!code || !/^[A-Z0-9-]{3,40}$/.test(code)) throw new Error('--code must be 3–40 letters, digits or dashes');
  const percentOff = int('percent');
  const amountOff = int('amount-off');
  if ((percentOff === undefined) === (amountOff === undefined))
    throw new Error('Give exactly one of --percent or --amount-off (pence)');
  if (percentOff !== undefined && percentOff > 100) throw new Error('--percent cannot exceed 100');
  const duration = (str('duration') ?? 'once') as PromoCodeRequest['duration'];
  if (!['once', 'forever', 'repeating'].includes(duration))
    throw new Error('--duration must be once, forever or repeating');
  const months = int('months');
  if ((duration === 'repeating') !== (months !== undefined))
    throw new Error('--months is required with --duration repeating, and only then');
  // A one-time Lifetime payment only ever has one charge, so longer durations would be misleading.
  if (plan === 'lifetime' && duration !== 'once') throw new Error('Lifetime codes must use --duration once');
  const expires = str('expires');
  let expiresAt: number | undefined;
  if (expires !== undefined) {
    expiresAt = Date.parse(`${expires}T23:59:59Z`) / 1000;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expires) || !Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now())
      throw new Error('--expires must be a future date as YYYY-MM-DD');
  }
  const creator = str('creator');
  if (creator !== undefined && !/^[\w.-]{1,40}$/.test(creator)) throw new Error('--creator must be a short handle');
  return {
    plan,
    code,
    percentOff,
    amountOff,
    duration,
    months,
    maxUses: int('max-uses'),
    firstTime: values['first-time'] === true,
    expiresAt,
    creator,
  };
}

/** Same discount and plan always maps to the same coupon, so vending more codes never piles up coupons. */
export function promoCouponId(request: PromoCodeRequest) {
  // The two standard creator offers keep the coupons created at launch (docs/billing.md, creator runbook).
  if (request.plan === 'lifetime' && request.percentOff === 100) return 'holofolder-creator-lifetime';
  if (
    request.plan === 'monthly' &&
    request.percentOff === 100 &&
    request.duration === 'repeating' &&
    request.months === 1
  )
    return 'holofolder-creator-audience';
  const discount = request.percentOff !== undefined ? `pct${request.percentOff}` : `gbp${request.amountOff}`;
  const length = request.duration === 'repeating' ? `${request.months}mo` : request.duration;
  return `holofolder-${request.plan}-${discount}-${length}`;
}

/** Shown to customers in Checkout, so plain words; Stripe caps coupon names at 40 characters. */
export function promoCouponName(request: PromoCodeRequest) {
  const off =
    request.percentOff !== undefined ? `${request.percentOff}% off` : `£${(request.amountOff! / 100).toFixed(2)} off`;
  const length =
    request.duration === 'repeating'
      ? `for ${request.months} month${request.months === 1 ? '' : 's'}`
      : request.duration === 'forever'
        ? 'every payment'
        : 'the first payment';
  return `${off} ${length}`;
}

export function describePromoCode(request: PromoCodeRequest) {
  return [
    `${request.code}: ${promoCouponName(request)}, ${PROMO_PLANS[request.plan].label}`,
    request.maxUses ? `max ${request.maxUses} use${request.maxUses === 1 ? '' : 's'}` : 'unlimited uses',
    request.firstTime ? 'first-time customers only' : null,
    request.expiresAt ? `expires ${new Date(request.expiresAt * 1000).toISOString().slice(0, 10)}` : null,
    request.creator ? `creator ${request.creator}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}
