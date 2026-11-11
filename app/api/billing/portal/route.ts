import { billingErrorResponse } from '@/lib/server/billing';
import { billingUser, billingHeaders } from '@/lib/server/billing-request';
import { openBillingPortal } from '@/lib/server/billing-subscriptions';
export async function POST(request: Request) {
  try {
    const user = await billingUser(request, true);
    if (!user) return Response.json({ error: 'Sign in to manage billing.' }, { status: 401, headers: billingHeaders });
    return Response.json({ url: await openBillingPortal(user.id) }, { headers: billingHeaders });
  } catch (error) {
    return billingErrorResponse(error);
  }
}
