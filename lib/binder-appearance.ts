import { DESIGN_SURFACES, isCardArtworkUrl, normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"

export const BINDER_ARTWORK_BUCKET = "binder-artwork"
export const MAX_BINDER_ARTWORK_BYTES = 5 * 1024 * 1024
export const BINDER_ARTWORK_TYPES = ["image/png", "image/jpeg", "image/webp"] as const
export function isBinderUploadId(value: unknown): value is string {
  return typeof value === "string" && /^upload:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
export function binderArtworkPath(ownerId: string, id: string) {
  if (!isBinderUploadId(id)) throw new Error("Invalid artwork id")
  return `${ownerId}/${id.slice(7).toLowerCase()}`
}
export function binderArtworkIds(design: BinderDesign) {
  return [...new Set(DESIGN_SURFACES.map(surface => design.surfaces[surface].artwork).filter(isBinderUploadId))]
}
export function parseBinderAppearance(value: unknown): { design: BinderDesign; baseRevision: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid appearance payload")
  const body = value as Record<string, unknown>
  if (!Number.isSafeInteger(body.baseRevision) || (body.baseRevision as number) < 0) throw new Error("Invalid appearance revision")
  if (!body.design || typeof body.design !== "object" || Array.isArray(body.design)) throw new Error("Invalid binder design")
  const input = body.design as Record<string, unknown>
  if (input.version !== 1 || !input.surfaces || typeof input.surfaces !== "object" || Array.isArray(input.surfaces)) throw new Error("Invalid binder design")
  for (const surface of DESIGN_SURFACES) {
    const entry = (input.surfaces as Record<string, unknown>)[surface]
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Invalid binder surface")
    const artwork = (entry as Record<string, unknown>).artwork
    if (artwork !== null && !isBinderUploadId(artwork) && !isCardArtworkUrl(artwork)) throw new Error("Invalid artwork reference")
  }
  return { design: normalizeBinderDesign(input), baseRevision: body.baseRevision as number }
}
