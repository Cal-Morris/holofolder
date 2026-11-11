import { withAuditActor } from '@/lib/server/audit-context';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getFirstPartyUser, getSessionUser } from '@/lib/supabase/session-user';
import { listBinders, createBinder, updateBinder, deleteBinder } from '@/lib/server/operations/binders';
export async function GET() {
  const client = await createClient();
  const user = await getSessionUser(client);
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return listBinders(user);
}
export async function POST(request: NextRequest) {
  const client = await createClient();
  const user = (await getFirstPartyUser(client)).data.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return withAuditActor(user.id, () => createBinder(request, user));
}
export async function PATCH(request: NextRequest) {
  const client = await createClient();
  const user = (await getFirstPartyUser(client)).data.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return withAuditActor(user.id, () => updateBinder(request, user));
}
export async function DELETE(request: NextRequest) {
  const client = await createClient();
  const user = (await getFirstPartyUser(client)).data.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  return withAuditActor(user.id, () => deleteBinder(request, user));
}
