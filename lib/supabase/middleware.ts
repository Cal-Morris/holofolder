import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSignedOutRedirectPath } from '@/lib/auth-redirects'

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Do not run code between createServerClient and supabase.auth.getClaims(). A simple mistake
  // could make it very hard to debug issues with users being randomly logged out.
  //
  // getClaims() refreshes an expired session (writing the new cookies through setAll above) and
  // verifies the access token's signature locally against the project's cached JWKS (ES256), so
  // the proxy no longer makes a Supabase Auth round trip on every request the way getUser() did.
  // Pages and route handlers that need the full user record still call getUser() themselves.
  const { data: claimsData } = await supabase.auth.getClaims()
  const user = claimsData?.claims?.sub ? claimsData.claims : null

  if (
    // if the user is not logged in and the app path, in this case, /protected, is accessed, redirect to the login page
    request.nextUrl.pathname.startsWith('/protected') &&
    !user
  ) {
    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Signed-out visitors to the binder go straight to the landing page with a 307, before the page
  // streams its loading screen and binder JS (which would then redirect on the client).
  const signedOutRedirect = getSignedOutRedirectPath(request.nextUrl.pathname, Boolean(user))
  if (signedOutRedirect) {
    const url = request.nextUrl.clone()
    url.pathname = signedOutRedirect
    url.search = ''
    const redirectResponse = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse
}
