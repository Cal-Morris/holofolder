import { appRedirectUrl } from '@/lib/auth-redirects';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// oxlint-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- binder-app links here with GET; moving logout to POST needs those callers changed first.
export async function GET(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  return NextResponse.redirect(appRedirectUrl('/auth/login', request.url));
}
