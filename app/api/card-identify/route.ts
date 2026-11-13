import { IDENTIFY_INDEX_LANGUAGES, IDENTIFY_MAX_IMAGE_BYTES, IDENTIFY_RATE_LIMITS } from '@/lib/card-identify';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { requireAppearanceOrigin } from '@/lib/server/binder-appearance';
import { identifyCardPicture } from '@/lib/server/card-identify';
import { consumeCardIdentifyLimit, hashedClientIp } from '@/lib/server/developer-access/limits';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/session-user';

export const instant = false;

const headers = { 'Cache-Control': 'no-store' };

/**
 * POST /app/api/card-identify?languages=en,ja with the crop as the body (image/jpeg, png or webp)
 *   → { matches: PictureMatch[], ms }
 * The app's online picture scans before the scanner is downloaded (lib/card-picture-scanner.ts): the same matches
 * the on-device worker returns, from the server matcher. Same-origin only, signed in or not, rate limited per account
 * or, for guests, per IP. Developers use POST /api/v1/cards/identify instead.
 */
export async function POST(request: Request) {
  try {
    requireAppearanceOrigin(request);
    if (Number(request.headers.get('content-length') ?? 0) > IDENTIFY_MAX_IMAGE_BYTES)
      return Response.json({ error: 'Image too large.' }, { status: 413, headers });
    const image = new Uint8Array(await request.arrayBuffer());
    if (!image.byteLength || image.byteLength > IDENTIFY_MAX_IMAGE_BYTES)
      return Response.json({ error: 'Send one image of at most 3 MB.' }, { status: 400, headers });
    const requested = (new URL(request.url).searchParams.get('languages') ?? '').split(',');
    const languages = IDENTIFY_INDEX_LANGUAGES.filter((language) => requested.includes(language));
    // Behind Framer's proxy the IP can be a shared proxy address, so signed-in scans count against the account.
    const user = await getSessionUser(await createClient()).catch(() => null);
    const who = user ? `app:user:${user.id}` : `app:ip:${hashedClientIp(request) ?? 'local'}`;
    await consumeCardIdentifyLimit(who, IDENTIFY_RATE_LIMITS.app);
    const result = await identifyCardPicture(image, languages.length ? languages : null);
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof DeveloperAccessError)
      return Response.json(
        { error: error.message, code: error.code },
        {
          status: error.status,
          headers: { ...headers, ...(error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {}) },
        },
      );
    if (error instanceof Error && 'status' in error && error.status === 403)
      return Response.json({ error: 'Request origin is not allowed' }, { status: 403, headers });
    console.error('[holofolder] Card identify failed:', error);
    return Response.json({ error: 'Picture matching is unavailable right now.' }, { status: 503, headers });
  }
}
