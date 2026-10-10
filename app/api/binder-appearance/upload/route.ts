import { BINDER_ARTWORK_BUCKET, BINDER_ARTWORK_TYPES, MAX_BINDER_ARTWORK_BYTES, binderArtworkPath, isBinderUploadId } from "@/lib/binder-appearance"
import { AppearanceError, appearanceError, appearanceJson, readAppearance, requireAppearanceOrigin, requireAppearanceOwner } from "@/lib/server/binder-appearance"

export async function POST(request: Request) {
  try {
    requireAppearanceOrigin(request)
    const { admin, ownerId } = await requireAppearanceOwner(request)
    const body = await request.json().catch(() => null)
    if (!body || !isBinderUploadId(body.id) || !BINDER_ARTWORK_TYPES.includes(body.mimeType) || !Number.isSafeInteger(body.size) || body.size <= 0 || body.size > MAX_BINDER_ARTWORK_BYTES) throw new AppearanceError("Choose a PNG, JPEG or WebP image under 5 MB.", 400)
    await readAppearance(admin, ownerId)
    const path = binderArtworkPath(ownerId, body.id)
    const existing = await admin.storage.from(BINDER_ARTWORK_BUCKET).exists(path)
    if (existing.data) return appearanceJson({ id: body.id, exists: true })
    const { data, error } = await admin.storage.from(BINDER_ARTWORK_BUCKET).createSignedUploadUrl(path, { upsert: false })
    if (error || !data) throw new AppearanceError("Artwork upload is unavailable. Your draft is still here.", 503)
    return appearanceJson({ id: body.id, path, token: data.token, signedUrl: data.signedUrl })
  } catch (error) { return appearanceError(error) }
}
