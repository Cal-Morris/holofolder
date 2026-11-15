import { NextResponse } from 'next/server';
import { appRedirectUrl } from '@/lib/auth-redirects';
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, isInviteCode, signInviteCookie } from '@/lib/referrals';

/** An invite link: remember the click (signed, server time), then go to the app, which sends new visitors to sign in. */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toLowerCase();
  const response = NextResponse.redirect(appRedirectUrl('/', request.url));
  if (!isInviteCode(code)) return response;
  // First touch: a second invite link on this device doesn't replace a click that is still pending.
  if (request.headers.get('cookie')?.includes(`${INVITE_COOKIE}=`)) return response;
  response.cookies.set(INVITE_COOKIE, signInviteCookie(process.env.SUPABASE_SERVICE_ROLE_KEY!, code), {
    path: '/app',
    maxAge: INVITE_COOKIE_MAX_AGE,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
