import { appleAppSiteAssociation } from '@/lib/apple-app-site-association';

// Served at /app/.well-known/apple-app-site-association; a Framer Multi Site rewrite serves it at
// https://holofolder.com/.well-known/apple-app-site-association, where Apple reads it.
export function GET() {
  return Response.json(appleAppSiteAssociation(), { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
