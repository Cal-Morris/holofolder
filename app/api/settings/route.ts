import { withAuditActor } from '@/lib/server/audit-context';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirstPartyUser, getSessionUser } from '@/lib/supabase/session-user';
import { getCollectionSettings, saveCollectionSettings } from '@/lib/server/operations/settings';
export async function GET(request: NextRequest) {
  const client = await createClient();
  const user = await getSessionUser(client);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return getCollectionSettings(request, user);
}
export async function PUT(request: NextRequest) {
  const client = await createClient();
  const user = (await getFirstPartyUser(client)).data.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return withAuditActor(user.id, () => saveCollectionSettings(request, user));
}
