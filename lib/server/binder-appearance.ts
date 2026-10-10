import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"
import { BINDER_ARTWORK_BUCKET, MAX_BINDER_ARTWORK_BYTES, binderArtworkPath } from "@/lib/binder-appearance"

export class AppearanceError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message) }
}
export function appearanceJson(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })
}
export function requireAppearanceOrigin(request: Request) {
  const origin = request.headers.get("origin")
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) throw new AppearanceError("Request origin is not allowed", 403)
}
export function appearanceError(error: unknown) {
  if (error instanceof AppearanceError) return appearanceJson({ error: error.message, code: error.code }, error.status)
  console.error("[binderdex] Appearance request failed", error)
  return appearanceJson({ error: "Appearance could not be synced. Your draft is still here." }, 500)
}
export function checkAppearanceDatabaseError(error: { code?: string } | null) {
  if (!error) return
  if (["42P01", "PGRST205"].includes(error.code ?? "")) throw new AppearanceError("Appearance syncing is not available yet. Your device draft is safe.", 503, "appearance_unavailable")
  throw error
}
export function requireExpectedAppearanceOwner(request: Request, ownerId: string) {
  if (request.headers.get("X-Binder-Owner") !== ownerId) throw new AppearanceError("Your collection changed. Reopen the binder before syncing.", 403)
}
export async function requireAppearanceOwner(request: Request) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) throw new AppearanceError("Not authenticated", 401)
  const admin = createAdminClient()
  const ownerId = await resolveCollectionOwnerUserId(admin, user.id)
  requireExpectedAppearanceOwner(request, ownerId)
  return { admin, ownerId }
}
export async function readAppearance(admin: ReturnType<typeof createAdminClient>, ownerId: string) {
  const { data, error } = await admin.from("binder_appearances").select("design, revision").eq("owner_user_id", ownerId).maybeSingle()
  checkAppearanceDatabaseError(error)
  return { ownerId, design: data ? normalizeBinderDesign(data.design) : null, revision: data ? Number(data.revision) : 0 }
}
export async function loadBinderArtwork(admin: ReturnType<typeof createAdminClient>, ownerId: string, id: string) {
  const { data, error } = await admin.storage.from(BINDER_ARTWORK_BUCKET).download(binderArtworkPath(ownerId, id))
  if (error || !data) throw new AppearanceError("Artwork is missing. Re-upload it before saving.", 400)
  if (!data.size || data.size > MAX_BINDER_ARTWORK_BYTES) throw new AppearanceError("Choose an image under 5 MB.", 400)
  const bytes = Buffer.from(await data.arrayBuffer())
  const { default: sharp } = await import("sharp")
  let metadata
  try { metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata() }
  catch { throw new AppearanceError("This artwork could not be opened. Choose another image.", 400) }
  if (!["png", "jpeg", "webp"].includes(metadata.format ?? "") || !metadata.width || !metadata.height || metadata.width * metadata.height > 24_000_000 || (metadata.pages ?? 1) > 1) throw new AppearanceError("Choose a PNG, JPEG or WebP image smaller than 24 megapixels.", 400)
  return { bytes, contentType: `image/${metadata.format}` }
}
export async function writeAppearance(admin: ReturnType<typeof createAdminClient>, ownerId: string, design: BinderDesign, baseRevision: number) {
  if (baseRevision >= Number.MAX_SAFE_INTEGER) throw new AppearanceError("Invalid appearance revision", 400)
  const row = { owner_user_id: ownerId, design, revision: baseRevision + 1, updated_at: new Date().toISOString() }
  const result = baseRevision === 0
    ? await admin.from("binder_appearances").upsert(row, { onConflict: "owner_user_id", ignoreDuplicates: true }).select("revision").maybeSingle()
    : await admin.from("binder_appearances").update(row).eq("owner_user_id", ownerId).eq("revision", baseRevision).select("revision").maybeSingle()
  checkAppearanceDatabaseError(result.error)
  if (!result.data) return null
  return { ownerId, design, revision: Number(result.data.revision) }
}
