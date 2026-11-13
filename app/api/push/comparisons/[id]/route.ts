import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/supabase/session-user';
import { normalizeComparisonJob } from '@/lib/comparison-jobs';

const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser(await createClient());
  if (!user) return Response.json({}, { status: 401, headers });
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({}, { status: 400, headers });
  const { data, error } = await createAdminClient()
    .from('comparison_jobs')
    .select('id,status,progress')
    .eq('id', id)
    .eq('initiated_by', user.id)
    .eq('status', 'completed')
    .maybeSingle();
  if (error) return Response.json({}, { status: 503, headers });
  const job = normalizeComparisonJob(data);
  if (!job) return Response.json({}, { status: 404, headers });
  const { fresh, checked, total, failed } = job.progress;
  return Response.json(
    {
      title: 'Price checks finished',
      body: `${fresh + checked} of ${total} printings ready.${failed ? ` ${failed} couldn't be checked.` : ''}`,
      url: '/app',
    },
    { headers },
  );
}
