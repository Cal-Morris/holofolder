// Vend, list and deactivate Holo Folder promotion codes in the live Stripe account. Dry run unless --apply.
//   bun --env-file=.env.local scripts/promo-code.ts --plan lifetime --code ASH-LIFETIME --percent 100 --max-uses 1 --apply
//   bun --env-file=.env.local scripts/promo-code.ts --plan monthly --code ASH --percent 100 --duration repeating --months 1 --first-time --apply
//   bun --env-file=.env.local scripts/promo-code.ts --list
//   bun --env-file=.env.local scripts/promo-code.ts --deactivate ASH --apply
import { parseArgs } from 'node:util';
import Stripe from 'stripe';
import {
  PROMO_PLANS,
  describePromoCode,
  parsePromoCodeRequest,
  promoCouponId,
  promoCouponName,
} from '../lib/billing-promo-codes';

const HOLO_ACCOUNT = 'acct_1AHHDjGnHtZtNtvx';

async function main() {
  const { values } = parseArgs({
    options: {
      plan: { type: 'string' },
      code: { type: 'string' },
      percent: { type: 'string' },
      'amount-off': { type: 'string' },
      duration: { type: 'string' },
      months: { type: 'string' },
      'max-uses': { type: 'string' },
      'first-time': { type: 'boolean' },
      expires: { type: 'string' },
      creator: { type: 'string' },
      list: { type: 'boolean' },
      deactivate: { type: 'string' },
      apply: { type: 'boolean' },
    },
  });
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '');
  if ((await stripe.accounts.retrieve(null)).id !== HOLO_ACCOUNT)
    throw new Error('STRIPE_SECRET_KEY is not for the Holo Folder Stripe account; nothing changed');
  const apply = values.apply === true;

  if (values.list) {
    for await (const promo of stripe.promotionCodes.list({ limit: 100 })) {
      if (promo.metadata?.app !== 'holofolder') continue;
      const coupon = typeof promo.promotion.coupon === 'string' ? promo.promotion.coupon : promo.promotion.coupon?.id;
      const uses = `${promo.times_redeemed}${promo.max_redemptions ? `/${promo.max_redemptions}` : ''}`;
      console.log(
        `${promo.active ? 'active  ' : 'inactive'}  ${promo.code.padEnd(24)} uses ${uses.padEnd(7)} ${coupon}  ${promo.id}`,
      );
    }
    return;
  }

  if (values.deactivate) {
    const code = values.deactivate.trim().toUpperCase();
    const { data } = await stripe.promotionCodes.list({ code, active: true, limit: 10 });
    const promo = data.find((p) => p.metadata?.app === 'holofolder');
    if (!promo) throw new Error(`No active Holo Folder code ${code}`);
    console.log(
      `${apply ? 'Deactivating' : 'Would deactivate'} ${promo.code} (${promo.id}), used ${promo.times_redeemed}`,
    );
    if (apply) await stripe.promotionCodes.update(promo.id, { active: false });
    return;
  }

  const request = parsePromoCodeRequest(values);
  const { data: prices } = await stripe.prices.list({ lookup_keys: [PROMO_PLANS[request.plan].lookupKey], limit: 1 });
  const product = typeof prices[0]?.product === 'string' ? prices[0].product : prices[0]?.product.id;
  if (!product || !prices[0].active) throw new Error(`No active price for ${PROMO_PLANS[request.plan].lookupKey}`);
  const { data: clash } = await stripe.promotionCodes.list({ code: request.code, active: true, limit: 1 });
  if (clash.length) throw new Error(`An active code ${request.code} already exists`);

  const couponId = promoCouponId(request);
  const existing = await stripe.coupons.retrieve(couponId, { expand: ['applies_to'] }).catch(() => null);
  if (existing && (!existing.valid || existing.applies_to?.products.join() !== product))
    throw new Error(`Coupon ${couponId} exists but is invalid or scoped to another product; nothing changed`);
  console.log(describePromoCode(request));
  console.log(`Coupon ${couponId} (${existing ? 'reused' : 'new'}), product ${product}`);
  if (!apply) return console.log('Dry run. Add --apply to create it.');

  const coupon =
    existing ??
    (await stripe.coupons.create(
      {
        id: couponId,
        name: promoCouponName(request),
        ...(request.percentOff !== undefined
          ? { percent_off: request.percentOff }
          : { amount_off: request.amountOff, currency: 'gbp' }),
        duration: request.duration,
        ...(request.months ? { duration_in_months: request.months } : {}),
        applies_to: { products: [product] },
        metadata: { app: 'holofolder', plan: request.plan },
      },
      { idempotencyKey: couponId },
    ));
  const promo = await stripe.promotionCodes.create({
    promotion: { type: 'coupon', coupon: coupon.id },
    code: request.code,
    ...(request.maxUses ? { max_redemptions: request.maxUses } : {}),
    ...(request.expiresAt ? { expires_at: request.expiresAt } : {}),
    ...(request.firstTime ? { restrictions: { first_time_transaction: true } } : {}),
    metadata: { app: 'holofolder', plan: request.plan, ...(request.creator ? { creator: request.creator } : {}) },
  });
  console.log(`Created ${promo.code} (${promo.id})`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
