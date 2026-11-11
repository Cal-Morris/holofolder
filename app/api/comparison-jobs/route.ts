import { createClient } from '@/lib/supabase/server';
import { getFirstPartyUser, getSessionUser } from '@/lib/supabase/session-user';
import { requireAppearanceOrigin, appearanceError } from '@/lib/server/binder-appearance';
import { readComparisonOperation, writeComparisonOperation } from '@/lib/server/operations/comparisons';
export async function GET(request: Request) {
  const user = await getSessionUser(await createClient());
  if (!user) return Response.json({ error: 'Sign in to check prices.' }, { status: 401 });
  return readComparisonOperation(request, user);
}
export async function POST(request: Request) {
  try {
    requireAppearanceOrigin(request);
    const {
      data: { user },
    } = await getFirstPartyUser(await createClient());
    if (!user) return Response.json({ error: 'Sign in to check prices.' }, { status: 401 });
    return writeComparisonOperation(request, user);
  } catch (error) {
    return appearanceError(error);
  }
}
