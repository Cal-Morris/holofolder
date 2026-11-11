import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/session-user';

export async function GET() {
  const user = await getSessionUser(await createClient());
  return Response.json(
    { signedIn: Boolean(user) },
    { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
  );
}
