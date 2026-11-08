import { needsCustomLayoutAccess } from "@/lib/binder-layout"
import { requirePaidAccess, billingErrorResponse } from "@/lib/server/billing"
import { isBillingError } from "@/lib/billing"
import { binderArtworkIds, parseBinderAppearance } from "@/lib/binder-appearance"
import { AppearanceError, appearanceError, appearanceJson, loadBinderArtwork, readAppearance, requireAppearanceOrigin, requireAppearanceOwner, writeAppearance } from "@/lib/server/binder-appearance"

export async function GET(request: Request) {
  try {
    const { admin, ownerId } = await requireAppearanceOwner(request, { readOnly: true })
    return appearanceJson(await readAppearance(admin, ownerId))
  } catch (error) { return appearanceError(error) }
}
export async function PUT(request: Request) {
  try {
    requireAppearanceOrigin(request)
    const { admin, ownerId } = await requireAppearanceOwner(request)
    if (Number(request.headers.get("content-length")) > 128 * 1024) throw new AppearanceError("Appearance payload is too large", 413)
    const text = await request.text()
    if (text.length > 128 * 1024) throw new AppearanceError("Appearance payload is too large", 413)
    let payload
    try { payload = parseBinderAppearance(JSON.parse(text)) }
    catch (error) { throw new AppearanceError(error instanceof Error ? error.message : "Invalid appearance payload", 400) }
    const current = await readAppearance(admin, ownerId)
    if (payload.baseRevision !== current.revision) return appearanceJson({ ...current, error: "Appearance changed on another device. Your draft is still here." }, 409)
    if (needsCustomLayoutAccess(payload.design, current.design)) await requirePaidAccess(ownerId)
    for (const id of binderArtworkIds(payload.design)) await loadBinderArtwork(admin, ownerId, id)
    const saved = await writeAppearance(admin, ownerId, payload.design, payload.baseRevision)
    if (!saved) return appearanceJson({ ...await readAppearance(admin, ownerId), error: "Appearance changed on another device. Your draft is still here." }, 409)
    return appearanceJson(saved)
  } catch (error) { return isBillingError(error) ? billingErrorResponse(error) : appearanceError(error) }
}
