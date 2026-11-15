import { connection } from 'next/server';
import { isBinderUploadId } from '@/lib/binder-appearance';
import { pageArtUploadIds } from '@/lib/page-art';
import type { PublicShareIdentity } from '@/lib/public-binder';
import { requireArtworkStore } from '@/lib/server/binder-appearance';
import { readPublicPageArt } from '@/lib/server/public-binder';

const artworkMissing = () => Response.json({ error: 'Artwork not found' }, { status: 404 });

/**
 * An uploaded page artwork on a public share: served only while that share is enabled and its binder's page art
 * uses this upload. Uploads stay private; this redirects to a five-minute signed URL.
 */
export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const id = params.get('id')?.toLowerCase();
  const token = params.get('token');
  const username = params.get('username');
  const binderSlug = params.get('slug');
  const identity: PublicShareIdentity | null = token
    ? { token }
    : username && binderSlug
      ? { username, binderSlug }
      : null;
  if (!identity || !isBinderUploadId(id)) return artworkMissing();
  try {
    const share = await readPublicPageArt(identity);
    if (!share || !pageArtUploadIds(share.pageArt).includes(id)) return artworkMissing();
    const store = requireArtworkStore();
    const signedUrl = await store.downloadUrl(share.owner, id);
    return new Response(null, {
      status: 302,
      headers: { Location: signedUrl, 'Cache-Control': 'private, max-age=240' },
    });
  } catch (error) {
    console.error('[holofolder] Share artwork failed', error);
    return Response.json({ error: 'Artwork could not load' }, { status: 503 });
  }
}
