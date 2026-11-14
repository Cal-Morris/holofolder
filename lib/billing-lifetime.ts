import type Stripe from 'stripe';
import { BILLING_LIFETIME_PRICE } from '@/lib/billing';

/** Validate the expanded one-time price and its dedicated product before a new lifetime sale. */
export function assertLifetimePrice(price: Stripe.Price) {
  const product = typeof price.product === 'string' ? null : price.product;
  if (
    !price.active ||
    price.type !== 'one_time' ||
    price.currency !== 'gbp' ||
    price.unit_amount !== BILLING_LIFETIME_PRICE ||
    price.billing_scheme !== 'per_unit' ||
    price.transform_quantity ||
    price.metadata.app !== 'holofolder' ||
    price.metadata.plan !== 'lifetime' ||
    !product ||
    product.deleted ||
    !product.active ||
    product.metadata.app !== 'holofolder' ||
    product.metadata.plan !== 'lifetime'
  )
    throw new Error('Lifetime pricing is temporarily unavailable. Try again shortly.');
}

export interface LifetimeGrant {
  ownerId: string;
  sessionId: string;
  promotionCodeId: string | null;
  amountPaid: number;
  at: string;
}

/**
 * A completed lifetime Checkout qualifies when it is ours, for this owner, a single £79 line of the configured
 * price, and either actually paid or brought to £0 by a promotion code. Anything else grants nothing.
 */
export function verifyLifetimeCheckout(
  session: Stripe.Checkout.Session,
  priceId: string,
  ownerId: string,
): LifetimeGrant | null {
  const lines = session.line_items;
  const promotion = session.discounts?.find((d) => d.promotion_code)?.promotion_code;
  const promotionCodeId = typeof promotion === 'string' ? promotion : (promotion?.id ?? null);
  const paid = session.payment_status === 'paid' && (session.amount_total ?? 0) > 0;
  const free = session.payment_status === 'no_payment_required' && session.amount_total === 0 && promotionCodeId;
  if (
    session.mode !== 'payment' ||
    session.status !== 'complete' ||
    session.currency !== 'gbp' ||
    session.metadata?.app !== 'holofolder' ||
    session.metadata.interval !== 'lifetime' ||
    session.metadata.owner_user_id !== ownerId ||
    session.client_reference_id !== ownerId ||
    session.amount_subtotal !== BILLING_LIFETIME_PRICE ||
    !lines ||
    lines.has_more ||
    lines.data.length !== 1 ||
    lines.data[0].quantity !== 1 ||
    lines.data[0].price?.id !== priceId ||
    !(paid || free)
  )
    return null;
  return {
    ownerId,
    sessionId: session.id,
    promotionCodeId,
    amountPaid: session.amount_total ?? 0,
    at: new Date(session.created * 1000).toISOString(),
  };
}

/**
 * Grants the licence idempotently. `grant` resolves false when the owner already had one (an earlier replay or an
 * existing lifetime), in which case nothing else is recorded. Only a positive payment counts as first paid.
 */
export async function fulfilLifetimeCheckout(
  session: Stripe.Checkout.Session,
  deps: {
    priceId: string;
    ownerId: string;
    grant: (grant: LifetimeGrant) => Promise<boolean>;
    recordFirstPaid: (at: string) => Promise<unknown>;
  },
) {
  const grant = verifyLifetimeCheckout(session, deps.priceId, deps.ownerId);
  if (!grant) return 'rejected' as const;
  if (!(await deps.grant(grant))) return 'already_lifetime' as const;
  if (grant.amountPaid > 0) await deps.recordFirstPaid(grant.at);
  return 'granted' as const;
}
