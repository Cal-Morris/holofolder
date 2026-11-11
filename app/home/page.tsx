import HomePage from '@/components/home-page';
import { createClient } from '@/lib/supabase/server';

export const instant = false;

async function hasSession() {
  const supabase = await createClient();
  // Local JWT verification (see lib/supabase/middleware.ts); no Supabase Auth round trip.
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims?.sub);
}

// Not async: the marketing page prerenders into the static shell. Only the signed-in labels
// wait on the session check, which reads cookies and so streams in at request time.
export default function Page() {
  return <HomePage signedIn={hasSession()} />;
}
