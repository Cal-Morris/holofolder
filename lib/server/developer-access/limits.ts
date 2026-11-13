import { createHmac } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
async function consumeBudget(bucket: string, limit: number) {
  const { data, error } = await createAdminClient().rpc('consume_developer_budget', {
    budget_bucket: bucket,
    request_limit: limit,
  });
  if (error || typeof data?.allowed !== 'boolean') throw new Error('Request budget unavailable');
  if (!data.allowed)
    throw new DeveloperAccessError(
      'rate_limited',
      'Request limit reached. Try again shortly.',
      429,
      Number(data.retry_after) || 60,
    );
}
export async function consumeDeveloperLimit(actorId: string, kind: 'read' | 'write') {
  return consumeBudget(`${actorId}:${kind}`, kind === 'read' ? 60 : 20);
}
/** Picture identification runs the model on our CPU: its own per-minute budget per API actor or app visitor. */
export function consumeCardIdentifyLimit(who: string, limit: number) {
  return consumeBudget(`card-identify:${who}`, limit);
}
/** A salted hash of the caller's IP on Vercel (never the IP itself); null elsewhere, e.g. local dev. */
export function hashedClientIp(request: Request): string | null {
  if (process.env.VERCEL !== '1') return null;
  // Vercel supplies this header; behind Framer it may identify a proxy.
  const ip = request.headers.get('x-vercel-forwarded-for') ?? 'unknown';
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!).update(ip.slice(0, 200)).digest('hex');
}
export function developerPreauthBucket(request: Request): string | null {
  const digest = hashedClientIp(request);
  return digest ? `preauth:${digest}` : null;
}
