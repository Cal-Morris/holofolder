import { updateSession } from '@/lib/supabase/middleware'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  // Framer drops Service-Worker-Allowed. A slashless script URL permits /app scope without that header.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.get("service-worker") === "1") {
    const url = request.nextUrl.clone()
    url.pathname = "/sw.js"
    url.search = ""
    return NextResponse.rewrite(url)
  }
  if (/^\/(?:share|u)(?:\/|$)/.test(request.nextUrl.pathname)) {
    // The cached PPR shell must not make a revocable binder response storable.
    const response = NextResponse.next()
    response.headers.set("Cache-Control", "private, no-cache, no-store, max-age=0, must-revalidate")
    response.headers.set("CDN-Cache-Control", "no-store")
    response.headers.set("Vercel-CDN-Cache-Control", "no-store")
    return response
  }
  return await updateSession(request)
}

// Paths the proxy skips. Anything here never needs the Supabase session refreshed:
// - Next.js build output and the image optimiser
// - Workflow internals
// - public, cacheable API routes (catalog reads and the image proxy)
// - static public files: the service worker, the web manifest, icons, images and fonts
// - /app-shell, the static offline shell the service worker precaches
// The matcher must stay an inline literal: Next.js reads it statically at build time.
export const config = {
  matcher: [
    "/",
    '/((?!_next/static|_next/image|\\.well-known/workflow|api/(?:ebay/account-deletion|card-image-proxy|card-prices|tcgdex-cache|tcg-set-slots|tcg-card-search)(?:/)?$|app-shell(?:/)?$|sw\\.js$|manifest\\.webmanifest$|favicon\\.ico$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|txt|xml)$).*)',
  ],
}
