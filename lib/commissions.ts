import type Stripe from 'stripe';
import { paidInvoiceThrough } from '@/lib/billing-subscription';

/** Commission programme (migration 140): 30% of what a referred customer actually pays, in basis points. */
export const COMMISSION_RATE_BPS = 3000;
/** Earnings stay pending this long after the payment so refunds and disputes can net them out first. */
export const COMMISSION_HOLD_DAYS = 30;
/** Subscription payments earn commission for this many months from attribution; a lifetime purchase always does. */
export const COMMISSION_WINDOW_MONTHS = 12;

const DAY = 86_400_000;
export const commissionPence = (paidPence: number, rateBps = COMMISSION_RATE_BPS) =>
  Math.floor((paidPence * rateBps) / 10_000);

/** Lower case, trimmed, without a `+tag`, so `ash+2@x.com` and `Ash@x.com` count as the same person. */
export function normaliseEmail(email: string | null | undefined) {
  const [local, domain, ...rest] = (email ?? '').trim().toLowerCase().split('@');
  if (!local || !domain || rest.length) return null;
  return `${local.split('+')[0]}@${domain}`;
}

export interface AffiliateCandidate {
  ownerId: string;
  /** Account and payout emails. */
  emails: (string | null)[];
  stripeCustomerId: string | null;
}

export interface AttributionInput {
  customerId: string;
  customerStripeId: string | null;
  /** The customer's account email and the email typed into Checkout. */
  customerEmails: (string | null)[];
  /** Has this Stripe customer made a real payment before this Checkout? Attribution must come first. */
  paidBefore: boolean;
  /** Active affiliate whose invite link created the account (earliest touch). */
  invitedBy: AffiliateCandidate | null;
  /** Active affiliate who owns the promotion code used at Checkout. */
  codeOwner: AffiliateCandidate | null;
  /** Owner ids partnered with the customer, either direction. */
  partners: string[];
}

export type Attribution =
  | { affiliateId: string; source: 'invite' | 'promotion_code' }
  | { rejected: 'no_affiliate' | 'already_paying' | 'self' };

/**
 * Picks at most one affiliate for a customer, at Checkout. First touch: the invite link (it made the account) beats a
 * code typed later. A candidate who is the customer, their partner, shares their Stripe customer or any email with them
 * is skipped; that is self-referral.
 */
export function chooseAffiliate(input: AttributionInput): Attribution {
  const candidates = [
    input.invitedBy && { ...input.invitedBy, source: 'invite' as const },
    input.codeOwner && { ...input.codeOwner, source: 'promotion_code' as const },
  ].filter((c) => c !== null);
  if (!candidates.length) return { rejected: 'no_affiliate' };
  if (input.paidBefore) return { rejected: 'already_paying' };
  const customerEmails = new Set(input.customerEmails.flatMap((email) => normaliseEmail(email) ?? []));
  const eligible = candidates.find(
    (c) =>
      c.ownerId !== input.customerId &&
      !input.partners.includes(c.ownerId) &&
      !(c.stripeCustomerId && c.stripeCustomerId === input.customerStripeId) &&
      !c.emails.some((email) => customerEmails.has(normaliseEmail(email) ?? '')),
  );
  return eligible ? { affiliateId: eligible.ownerId, source: eligible.source } : { rejected: 'self' };
}

export interface CustomerAttribution {
  affiliateId: string;
  customerId: string;
  attributedAt: string;
}

export interface CommissionEarning {
  affiliate_owner_id: string;
  customer_owner_id: string;
  kind: 'subscription' | 'lifetime';
  stripe_object_id: string;
  stripe_payment_ref: string;
  amount_paid_pence: number;
  rate_bps: number;
  commission_pence: number;
  occurred_at: string;
  hold_until: string;
}

function earning(
  attribution: CustomerAttribution,
  kind: CommissionEarning['kind'],
  objectId: string,
  paymentRef: string | null,
  paidPence: number,
  paidAtMs: number,
): CommissionEarning | null {
  const commission = commissionPence(paidPence);
  if (!paymentRef || !(commission > 0) || !Number.isFinite(paidAtMs)) return null;
  return {
    affiliate_owner_id: attribution.affiliateId,
    customer_owner_id: attribution.customerId,
    kind,
    stripe_object_id: objectId,
    stripe_payment_ref: paymentRef,
    amount_paid_pence: paidPence,
    rate_bps: COMMISSION_RATE_BPS,
    commission_pence: commission,
    occurred_at: new Date(paidAtMs).toISOString(),
    hold_until: new Date(paidAtMs + COMMISSION_HOLD_DAYS * DAY).toISOString(),
  };
}

const ref = (value: string | { id: string } | null | undefined) => (typeof value === 'string' ? value : value?.id);

/** The PaymentIntent (or bare charge) that paid an invoice, from its expanded `payments` list. */
export function invoicePaymentRef(invoice: Pick<Stripe.Invoice, 'payments'>) {
  const paid = invoice.payments?.data.find((p) => p.status === 'paid');
  return ref(paid?.payment.payment_intent) ?? ref(paid?.payment.charge) ?? null;
}

/**
 * A paid Holo Folder subscription invoice earns 30% of `amount_paid` (after discounts, so a free month earns nothing)
 * while it was paid within 12 months of attribution. Only GBP and recognised Holo Folder prices count.
 */
export function invoiceEarning(
  invoice: Pick<
    Stripe.Invoice,
    'id' | 'status' | 'currency' | 'amount_paid' | 'status_transitions' | 'lines' | 'payments'
  >,
  attribution: CustomerAttribution,
  prices: string[],
): CommissionEarning | null {
  const paidAt = (invoice.status_transitions.paid_at ?? 0) * 1000;
  const windowEnd = new Date(attribution.attributedAt);
  windowEnd.setUTCMonth(windowEnd.getUTCMonth() + COMMISSION_WINDOW_MONTHS);
  if (
    !invoice.id ||
    invoice.currency !== 'gbp' ||
    !paidInvoiceThrough(invoice, prices) ||
    !paidAt ||
    paidAt >= windowEnd.getTime()
  )
    return null;
  return earning(attribution, 'subscription', invoice.id, invoicePaymentRef(invoice), invoice.amount_paid, paidAt);
}

/** A verified lifetime Checkout earns 30% of what was actually paid. A £0 creator-code redemption earns nothing. */
export function lifetimeEarning(
  session: Pick<Stripe.Checkout.Session, 'id' | 'payment_intent' | 'amount_total' | 'created'>,
  attribution: CustomerAttribution,
): CommissionEarning | null {
  return earning(
    attribution,
    'lifetime',
    session.id,
    ref(session.payment_intent) ?? null,
    session.amount_total ?? 0,
    session.created * 1000,
  );
}

/** Dispute states where Stripe has taken the money back (or kept it). Inquiries, won and prevented ones have not. */
const DISPUTE_HOLDS = new Set([
  'needs_response',
  'under_review',
  'lost',
  'appeal_needs_response',
  'appeal_under_review',
]);

/**
 * What a charge still has paid right now: nothing while a dispute holds the money, else the amount minus refunds. The
 * charge and its disputes are read fresh from Stripe on every refund or dispute event, so the result is absolute and
 * replays or out-of-order events converge on the same commission.
 */
export function chargeStillPaid(
  charge: Pick<Stripe.Charge, 'id' | 'payment_intent' | 'amount' | 'amount_refunded'>,
  disputeStatuses: string[],
) {
  return {
    paymentRef: ref(charge.payment_intent) ?? charge.id,
    remainingPaid: disputeStatuses.some((status) => DISPUTE_HOLDS.has(status))
      ? 0
      : Math.max(0, charge.amount - charge.amount_refunded),
  };
}

export interface LedgerRow {
  id?: string;
  commission_pence: number;
  status: string;
  hold_until: string;
}

/** Pending (in the 30-day hold), payable (hold over, not paid yet) and paid totals in pence. */
export function summariseEarnings(rows: LedgerRow[], now = Date.now()) {
  const totals = { pendingPence: 0, payablePence: 0, paidPence: 0 };
  for (const row of rows) {
    if (row.status === 'paid') totals.paidPence += row.commission_pence;
    else if (new Date(row.hold_until).getTime() <= now) totals.payablePence += row.commission_pence;
    else totals.pendingPence += row.commission_pence;
  }
  return totals;
}
