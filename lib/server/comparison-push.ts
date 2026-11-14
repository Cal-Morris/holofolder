import { sendNotification } from 'web-push';
import { RetryableError } from 'workflow';
import { createAdminClient } from '@/lib/supabase/admin';
import { readComparisonJob } from '@/lib/server/comparison-jobs';
import { pushConfigured } from '@/lib/server/partner-push';

export async function comparisonCompletionDevices(jobId: string): Promise<string[]> {
  if (!pushConfigured()) return [];
  const job = await readComparisonJob(jobId, undefined, ['status', 'initiated_by']);
  if (job?.status !== 'completed' || !job.initiated_by) return [];
  // Device registration limits each user to 12 subscriptions.
  const { data, error } = await createAdminClient()
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', job.initiated_by)
    .limit(12);
  if (error) throw new Error('Could not read price check notification devices');
  return (data ?? []).map((device) => String(device.id));
}

export async function sendComparisonCompletion(jobId: string, subscriptionId: string) {
  if (!pushConfigured()) return;
  const admin = createAdminClient();
  const [job, { data: subscription, error }] = await Promise.all([
    readComparisonJob(jobId, undefined, ['id', 'status', 'initiated_by']),
    admin.from('push_subscriptions').select('user_id,endpoint,p256dh,auth').eq('id', subscriptionId).maybeSingle(),
  ]);
  if (error) throw new Error('Could not read price check notification device');
  if (job?.status !== 'completed' || !job.initiated_by || subscription?.user_id !== job.initiated_by) return;
  try {
    await sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify({
        kind: 'comparison',
        recipientId: job.initiated_by,
        eventId: job.id,
        tag: `comparison:${job.id}`,
      }),
      {
        vapidDetails: {
          subject: process.env.VAPID_SUBJECT!,
          publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
          privateKey: process.env.VAPID_PRIVATE_KEY!,
        },
        TTL: 3600,
        timeout: 10_000,
      },
    );
  } catch (error) {
    const status = typeof error === 'object' && error && 'statusCode' in error ? Number(error.statusCode) : 0;
    if (status === 404 || status === 410) {
      const { error: deleteError } = await admin
        .from('push_subscriptions')
        .delete()
        .eq('id', subscriptionId)
        .eq('user_id', job.initiated_by);
      if (deleteError) throw new Error('Could not remove expired price check notification device');
      return;
    }
    if (!status || status === 429 || status >= 500)
      throw new RetryableError('Push service is temporarily unavailable', { retryAfter: '15s' });
    console.warn('[holofolder] Price check notification was rejected', { jobId, status });
  }
}
