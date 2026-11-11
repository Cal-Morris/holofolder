import { connection } from 'next/server';
import { isBinderUploadId } from '@/lib/binder-appearance';
import {
  AppearanceError,
  appearanceError,
  requireAppearanceOwner,
  requireArtworkStore,
} from '@/lib/server/binder-appearance';

export async function GET(request: Request) {
  // Per-user and per-request: don't let the build try to prerender it. Otherwise cookies() rejects
  // once the prerender ends and the catch below logs a spurious "Appearance request failed".
  await connection();
  try {
    const { ownerId } = await requireAppearanceOwner(request, { readOnly: true });
    const id = new URL(request.url).searchParams.get('id');
    if (!isBinderUploadId(id)) throw new AppearanceError('Invalid artwork id', 400);
    const store = requireArtworkStore();
    if (!(await store.exists(ownerId, id))) throw new AppearanceError('Artwork could not load', 404);
    const signedUrl = await store.downloadUrl(ownerId, id);
    // shortcut: short-lived private redirect avoids Vercel's 4.5 MB response limit for 5 MB artwork.
    return new Response(null, { status: 302, headers: { Location: signedUrl, 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return appearanceError(error);
  }
}
