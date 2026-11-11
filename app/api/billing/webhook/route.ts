import { getStripe } from '@/lib/server/stripe';
import { handleBillingEvent } from '@/lib/server/billing-subscriptions';
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET,
    signature = request.headers.get('stripe-signature');
  if (!secret) return new Response('Billing webhook is not configured', { status: 503 });
  if (!signature) return new Response('Missing signature', { status: 400 });
  let event;
  try {
    event = await getStripe().webhooks.constructEventAsync(await request.text(), signature, secret);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  try {
    await handleBillingEvent(event);
    return Response.json({ received: true });
  } catch {
    return new Response('Webhook processing failed; retry delivery', { status: 503 });
  }
}
