import { getFirstPartyUser } from '@/lib/supabase/session-user';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { preferManagedVercelWorkflowWorld } from '@/lib/server/workflow-world';

async function resolveCollectionOwnerUserId(userId: string) {
  const admin = createAdminClient();
  const { data: partnership, error } = await admin
    .from('partnerships')
    .select('owner_user_id')
    .or(`user1_id.eq.${userId},user2_id.eq.${userId}`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return partnership?.owner_user_id || userId;
}

async function startCardPriceRefresh(input: { ownerUserId: string | null; repeatCount?: number; interval?: string }) {
  preferManagedVercelWorkflowWorld();

  const [{ start }, { refreshCardPricesWorkflow }] = await Promise.all([
    import('workflow/api'),
    import('@/workflows/card-price-refresh'),
  ]);
  const run = await start(refreshCardPricesWorkflow, [input]);

  return NextResponse.json({
    refresh: {
      status: 'started',
      runId: run.runId,
      scope: input.ownerUserId ? 'owner' : 'all',
      repeatCount: input.repeatCount ?? 1,
      interval: input.interval ?? null,
    },
  });
}

function isAuthorizedCronRequest(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorizedCronRequest(request)) {
      return NextResponse.json({ error: 'Not authorized' }, { status: 401 });
    }

    // One pass per cron invocation (vercel.json schedules it every 3 hours). A long multi-pass run with
    // sleeps between passes stored far more workflow data than several short runs.
    return await startCardPriceRefresh({ ownerUserId: null, repeatCount: 1 });
  } catch (error) {
    console.error('[holofolder] Failed to start scheduled card price refresh workflow:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start scheduled price refresh.' },
      { status: 500 },
    );
  }
}

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await getFirstPartyUser(supabase);

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const ownerUserId = await resolveCollectionOwnerUserId(user.id);
    return await startCardPriceRefresh({ ownerUserId });
  } catch (error) {
    console.error('[holofolder] Failed to start card price refresh workflow:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start price refresh.' },
      { status: 500 },
    );
  }
}
