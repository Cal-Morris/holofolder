import { RetryableError, getWorkflowMetadata, getStepMetadata } from 'workflow';
import { createAdminClient } from '@/lib/supabase/admin';
import { readComparisonJob, checkComparisonTarget, comparisonJobActive } from '@/lib/server/comparison-jobs';
import { countComparisonResult, type ComparisonTarget } from '@/lib/comparison-jobs';
import { comparisonCompletionDevices, sendComparisonCompletion } from '@/lib/server/comparison-push';
import type { CheckCompsProgress } from '@/lib/check-comps';

export async function comparisonChecksWorkflow(jobId: string) {
  'use workflow';
  const job = await loadJob(jobId);
  if (!job) return;
  let progress = job.progress;
  // Two printings at once, matching the foreground provider budget. Every printing is a durable step.
  for (let index = progress.done; index < job.targets.length; index += 2) {
    if (!(await saveProgress(jobId, progress, 'running'))) return;
    const results = await Promise.all(
      job.targets.slice(index, index + 2).map((target) => checkTarget(jobId, target, progress.stopped)),
    );
    for (const result of results) if (result) progress = countComparisonResult(progress, result);
  }
  if (!(await saveProgress(jobId, progress, 'completed'))) return;
  const devices = await completionDevices(jobId);
  // Each successful delivery is a durable step; retries do not restart card checks.
  const deliveries = await Promise.allSettled(devices.map((deviceId) => notifyDevice(jobId, deviceId)));
  return { notificationsFailed: deliveries.filter((delivery) => delivery.status === 'rejected').length };
}
async function loadJob(jobId: string) {
  'use step';
  const { error } = await createAdminClient()
    .from('comparison_jobs')
    .update({ run_id: getWorkflowMetadata().workflowRunId })
    .eq('id', jobId);
  if (error) throw error;
  return readComparisonJob(jobId, undefined, ['targets', 'progress']);
}
async function checkTarget(jobId: string, target: ComparisonTarget, stopped: CheckCompsProgress['stopped']) {
  'use step';
  if (!(await comparisonJobActive(jobId))) return null;
  const result = await checkComparisonTarget(target, stopped, jobId);
  if (result.retryable && getStepMetadata().attempt < 3)
    throw new RetryableError('Comparison temporarily unavailable', { retryAfter: '2m' });
  return result;
}
async function saveProgress(jobId: string, progress: CheckCompsProgress, status: 'running' | 'completed') {
  'use step';
  const { data, error } = await createAdminClient()
    .from('comparison_jobs')
    .update({ progress, status, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .select('id');
  if (error) throw error;
  return Boolean(data?.length);
}

async function completionDevices(jobId: string) {
  'use step';
  return comparisonCompletionDevices(jobId);
}
async function notifyDevice(jobId: string, deviceId: string) {
  'use step';
  await sendComparisonCompletion(jobId, deviceId);
}
