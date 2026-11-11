import { createAdminClient } from '@/lib/supabase/admin';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import type { PriceCheckSource } from '@/lib/card-price-checks';

// Shared Postgres counters apply across instances, accounts, API keys and background jobs.
export async function consumePriceCheckBudget(bucket: string, limit: number) {
  const { data, error } = await createAdminClient().rpc('consume_developer_budget', {
    budget_bucket: bucket,
    request_limit: limit,
  });
  if (error || typeof data?.allowed !== 'boolean')
    throw new DeveloperAccessError('temporarily_unavailable', 'Price check limits are temporarily unavailable.', 503);
  if (!data.allowed)
    throw new DeveloperAccessError(
      'rate_limited',
      'Price check limit reached. Try again shortly.',
      429,
      Number(data.retry_after) || 60,
    );
}
export function consumePriceCheckProviderLimit(source: PriceCheckSource) {
  return consumePriceCheckBudget(`price-check:provider:${source}`, source === 'soldcomps' ? 10 : 60);
}
export function consumePriceCheckAccountLimit(ownerId: string, refresh: boolean) {
  return consumePriceCheckBudget(`price-check:account:${ownerId}:${refresh ? 'write' : 'read'}`, refresh ? 20 : 60);
}
export function priceCheckLimitResponse(error: unknown): Response | null {
  if (!(error instanceof DeveloperAccessError)) return null;
  return Response.json(
    { error: error.message },
    {
      status: error.status,
      headers: {
        'Cache-Control': 'no-store',
        ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}),
      },
    },
  );
}
