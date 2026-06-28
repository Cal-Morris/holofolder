import { updateSession } from '@/lib/supabase/middleware'
import { type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - public cacheable API routes
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|\\.well-known/workflow|api/(?:card-image-proxy|card-prices|tcgdex-cache|tcg-set-slots)(?:/)?$|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
