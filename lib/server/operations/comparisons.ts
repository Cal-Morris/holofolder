import { createHash } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { preferManagedVercelWorkflowWorld } from '@/lib/server/workflow-world';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner';
import { requirePaidAccess, billingErrorResponse } from '@/lib/server/billing';
import { isBillingError } from '@/lib/billing';
import { AppearanceError } from '@/lib/server/binder-appearance';
import { normalizeComparisonTargets } from '@/lib/comparison-jobs';
import {
  comparisonScopeKey,
  estimateComparisonSpend,
  initialComparisonProgress,
  publicComparisonJob,
  readComparisonJob,
  type StoredComparisonJob,
} from '@/lib/server/comparison-jobs';

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function owner(user: Pick<User, 'id'>, verifiedOwnerId?: string) {
  preferManagedVercelWorkflowWorld();
  const client = createAdminClient();
  const ownerId = verifiedOwnerId ?? (await resolveCollectionOwnerUserId(client, user.id));
  if (!verifiedOwnerId) await requirePaidAccess(ownerId);
  return { ownerId, userId: user.id };
}
function failure(error: unknown) {
  if (error instanceof AppearanceError) return json({ error: error.message }, error.status);
  if (isBillingError(error)) return billingErrorResponse(error);
  console.error('[holofolder] Comparison job unavailable', error);
  return json({ error: 'Background checks are temporarily unavailable. Saved checks are safe.' }, 503);
}
export async function readComparisonOperation(request: Request, actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const { ownerId } = await owner(actor, verifiedOwnerId);
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'Invalid job.' }, 400);
    let job = await readComparisonJob(id, ownerId);
    if (!job) return json({ error: 'Job not found.' }, 404);
    if ((job.status === 'queued' || job.status === 'running') && job.run_id) {
      const { getRun } = await import('workflow/api');
      const status = await getRun(job.run_id).status;
      if (status === 'failed' || status === 'cancelled') {
        const { error } = await createAdminClient()
          .from('comparison_jobs')
          .update({ status })
          .eq('id', id)
          .eq('owner_user_id', ownerId)
          .in('status', ['queued', 'running']);
        if (error) throw error;
        job = { ...job, status };
      }
    }
    return json({ job: publicComparisonJob(job) });
  } catch (error) {
    return failure(error);
  }
}
export async function writeComparisonOperation(request: Request, actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const text = await request.text();
    if (text.length > 1_000_000) return json({ error: 'Too many cards.' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'Invalid request.' }, 400);
    }
    const { ownerId, userId } = await owner(actor, verifiedOwnerId);
    const admin = createAdminClient();
    if (body?.action === 'stop') {
      if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) return json({ error: 'Invalid job.' }, 400);
      const job = await readComparisonJob(body.id, ownerId);
      if (!job) return json({ error: 'Job not found.' }, 404);
      const { error } = await admin
        .from('comparison_jobs')
        .update({ status: 'cancelled' })
        .eq('id', job.id)
        .eq('owner_user_id', ownerId)
        .in('status', ['queued', 'running']);
      if (error) throw error;
      if (job.run_id && (job.status === 'queued' || job.status === 'running')) {
        const { getRun } = await import('workflow/api');
        await getRun(job.run_id).cancel();
      }
      return json({ job: publicComparisonJob((await readComparisonJob(job.id, ownerId))!) });
    }
    if (body?.action !== 'inspect' && body?.action !== 'start') return json({ error: 'Invalid action.' }, 400);
    const targets = normalizeComparisonTargets(body.cards);
    if (!targets) return json({ error: 'Invalid comparison cards.' }, 400);
    const retryKey = request.headers.get('idempotency-key');
    const retryDigest = createHash('sha256')
      .update(JSON.stringify({ ownerId, targets, confirmed: body.confirmed === true }))
      .digest('hex');
    if (retryKey) {
      if (retryKey.length < 8 || retryKey.length > 100) return json({ error: 'Invalid idempotency key.' }, 400);
      const { data: previous, error: previousError } = await admin
        .from('developer_idempotency')
        .select('input_digest,result')
        .eq('actor_id', userId)
        .eq('operation', 'start_comparison_job')
        .eq('request_key', retryKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();
      if (previousError) throw previousError;
      if (previous) {
        if (previous.input_digest !== retryDigest)
          return json({ error: 'This idempotency key was used with another request.' }, 409);
        const job = await readComparisonJob(previous.result.id, ownerId);
        return job ? json({ job: publicComparisonJob(job) }) : json({ error: 'Job no longer available.' }, 404);
      }
    }
    const scopeKey = comparisonScopeKey(targets);
    const { data: existing, error: readError } = await admin
      .from('comparison_jobs')
      .select('*')
      .eq('owner_user_id', ownerId)
      .eq('scope_key', scopeKey)
      .in('status', ['queued', 'running'])
      .maybeSingle();
    if (readError) throw readError;
    if (existing) {
      if (existing.status === 'queued' && !existing.run_id && Date.parse(existing.created_at) < Date.now() - 120_000) {
        const { error: staleError } = await admin
          .from('comparison_jobs')
          .update({ status: 'failed' })
          .eq('id', existing.id)
          .eq('owner_user_id', ownerId)
          .eq('status', 'queued')
          .is('run_id', null);
        if (staleError) throw staleError;
      } else if (!retryKey) return json({ job: publicComparisonJob(existing as StoredComparisonJob) });
    }
    const needed = await estimateComparisonSpend(targets);
    if (body.action === 'inspect') {
      const { data: latest, error: latestError } = await admin
        .from('comparison_jobs')
        .select('*')
        .eq('owner_user_id', ownerId)
        .eq('scope_key', scopeKey)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      return json({ job: latest ? publicComparisonJob(latest as StoredComparisonJob) : null, needed });
    }
    if (needed >= 15 && body.confirmed !== true) return json({ needsConfirmation: true, needed }, 409);
    const values = {
      owner_user_id: ownerId,
      scope_key: scopeKey,
      targets,
      progress: initialComparisonProgress(targets.length),
    };
    const created = retryKey
      ? await admin.rpc('developer_create_comparison_job', {
          actor: userId,
          owner_id: ownerId,
          scope: scopeKey,
          job_targets: targets,
          job_progress: values.progress,
          retry_key: retryKey,
          digest: retryDigest,
        })
      : null;
    if (created?.error?.message?.includes('idempotency_conflict'))
      return json({ error: 'This idempotency key was used with another request.' }, 409);
    if (created?.error) throw created.error;
    if (created?.data && !created.data.created)
      return json({ job: publicComparisonJob(created.data.job as StoredComparisonJob) });
    let { data: inserted, error } = created
      ? { data: created.data?.job, error: null as { code: string; message: string } | null }
      : await admin
          .from('comparison_jobs')
          .insert({ ...values, initiated_by: userId })
          .select('*')
          .single();
    // Older schemas can still run checks, without completion notifications.
    if (error && ['PGRST204', '42703'].includes(error.code) && error.message.includes('initiated_by')) {
      ({ data: inserted, error } = await admin.from('comparison_jobs').insert(values).select('*').single());
    }
    if (error?.code === '23505') {
      const { data: active, error: activeError } = await admin
        .from('comparison_jobs')
        .select('*')
        .eq('owner_user_id', ownerId)
        .eq('scope_key', scopeKey)
        .in('status', ['queued', 'running'])
        .single();
      if (activeError) throw activeError;
      return json({ job: publicComparisonJob(active as StoredComparisonJob) });
    }
    if (error) throw error;
    const job = inserted as StoredComparisonJob;
    try {
      const [{ start }, { comparisonChecksWorkflow }] = await Promise.all([
        import('workflow/api'),
        import('@/workflows/comparison-checks'),
      ]);
      const run = await start(comparisonChecksWorkflow, [job.id]);
      const { error: saveError } = await admin
        .from('comparison_jobs')
        .update({ run_id: run.runId })
        .eq('id', job.id)
        .eq('owner_user_id', ownerId);
      if (saveError) throw saveError;
    } catch (error) {
      await admin
        .from('comparison_jobs')
        .update({ status: 'failed' })
        .eq('id', job.id)
        .eq('owner_user_id', ownerId)
        .eq('status', 'queued');
      throw error;
    }
    return json({ job: publicComparisonJob(job) }, 202);
  } catch (error) {
    return failure(error);
  }
}
