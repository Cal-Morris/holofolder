import { BINDER_ARTWORK_TYPES, MAX_BINDER_ARTWORK_BYTES, isBinderUploadId } from '@/lib/binder-appearance';
import {
  AppearanceError,
  appearanceError,
  appearanceJson,
  readAppearance,
  requireAppearanceOrigin,
  requireAppearanceOwner,
  requireArtworkStore,
} from '@/lib/server/binder-appearance';

export async function POST(request: Request) {
  try {
    requireAppearanceOrigin(request);
    const { admin, ownerId } = await requireAppearanceOwner(request);
    const body = await request.json().catch(() => null);
    if (
      !body ||
      !isBinderUploadId(body.id) ||
      !BINDER_ARTWORK_TYPES.includes(body.mimeType) ||
      !Number.isSafeInteger(body.size) ||
      body.size <= 0 ||
      body.size > MAX_BINDER_ARTWORK_BYTES
    )
      throw new AppearanceError('Choose a PNG, JPEG or WebP image under 5 MB.', 400);
    await readAppearance(admin, ownerId);
    const store = requireArtworkStore();
    if (await store.exists(ownerId, body.id)) return appearanceJson({ id: body.id, exists: true });
    return appearanceJson({ id: body.id, ...(await store.prepareUpload(ownerId, body.id, body.mimeType, body.size)) });
  } catch (error) {
    return appearanceError(error);
  }
}
