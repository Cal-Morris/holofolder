import { appRedirectUrl, readEmailLinkParams } from '@/lib/auth-redirects';
import { createClient } from '@/lib/supabase/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const email = readEmailLinkParams(searchParams);
  const tokenHash = email.tokenHash;
  const type = email.type as EmailOtpType | null;
  const next = email.next ?? '/';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(appRedirectUrl(next, request.url));
    }
  }

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      return NextResponse.redirect(appRedirectUrl(next, request.url));
    }
  }

  return NextResponse.redirect(appRedirectUrl('/auth/error', request.url));
}
