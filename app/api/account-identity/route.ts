import { getFirstPartyUser } from '@/lib/supabase/session-user';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/session-user';
import { normalizeUsername } from '@/lib/account-identity';

const headers = { 'cache-control': 'private, no-store' };
const unavailable = () =>
  Response.json({ error: 'Usernames are not available yet. Try again later.' }, { status: 503, headers });

export async function GET() {
  try {
    const client = await createClient();
    const user = await getSessionUser(client);
    if (!user) return Response.json({ error: 'Sign in to set your username.' }, { status: 401, headers });
    const { data, error } = await client
      .from('account_identities')
      .select('username')
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) return unavailable();
    return Response.json({ username: normalizeUsername(data?.username) }, { headers });
  } catch {
    return unavailable();
  }
}

export async function PATCH(request: Request) {
  try {
    const client = await createClient();
    const {
      data: { user },
      error: authError,
    } = await getFirstPartyUser(client);
    if (authError || !user) return Response.json({ error: 'Sign in to set your username.' }, { status: 401, headers });
    const body = await request.json().catch(() => null);
    const username = normalizeUsername(body?.username);
    if (!username)
      return Response.json(
        { error: 'Use 3–30 letters, numbers or hyphens, starting and ending with a letter or number.' },
        { status: 400, headers },
      );
    const { data, error } = await client.rpc('claim_account_username', { p_username: username });
    if (error?.code === '23505')
      return Response.json({ error: 'That username is already taken.' }, { status: 409, headers });
    if (error || data !== username) return unavailable();
    return Response.json({ username }, { headers });
  } catch {
    return unavailable();
  }
}
