import { normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"
import { binderArtworkIds } from "@/lib/binder-appearance"
import type { SavedBinderDesign } from "@/lib/binder-design-storage"
import { createClient } from "@/lib/supabase/client"

export interface RemoteBinderAppearance { ownerId: string; design: BinderDesign | null; revision: number }
export class AppearanceConflict extends Error {
  constructor() { super("This binder changed on another device. Your draft is safe. Load the latest appearance before saving again.") }
}
export function normalizeRemoteAppearance(value: unknown, owner: string): RemoteBinderAppearance {
  const data = value as Partial<RemoteBinderAppearance> | null
  if (!data || data.ownerId !== owner || !Number.isSafeInteger(data.revision) || data.revision! < 0 || (data.revision === 0 ? data.design !== null : !data.design || typeof data.design !== "object")) throw new Error("Could not verify the saved binder appearance.")
  return { ownerId: owner, revision: data.revision!, design: data.design ? normalizeBinderDesign(data.design) : null }
}
async function responseData(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null)
  if (response.status === 409) throw new AppearanceConflict()
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not sync your binder appearance.")
  return body
}
export async function fetchBinderAppearance(owner: string): Promise<RemoteBinderAppearance> {
  return normalizeRemoteAppearance(await responseData(await fetch("/app/api/binder-appearance", { cache: "no-store", credentials: "same-origin", headers: { "X-Binder-Owner": owner }, signal: AbortSignal.timeout(8000) })), owner)
}
export async function fetchArtwork(owner: string, design: BinderDesign): Promise<Record<string, Blob>> {
  const entries = await Promise.all(binderArtworkIds(design).map(async id => {
    const response = await fetch(`/app/api/binder-appearance/artwork?id=${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin", headers: { "X-Binder-Owner": owner }, signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error("Saved artwork could not load. Your cached appearance is still available.")
    const blob = await response.blob()
    if (!/^image\/(png|jpeg|webp)$/.test(blob.type) || blob.size > 5 * 1024 * 1024 || !blob.size) throw new Error("Saved artwork could not be verified.")
    return [id, blob] as const
  }))
  return Object.fromEntries(entries)
}
export async function syncBinderAppearance(owner: string, snapshot: SavedBinderDesign): Promise<RemoteBinderAppearance> {
  for (const id of binderArtworkIds(snapshot.design)) {
    const blob = snapshot.uploads[id]
    if (!blob) throw new Error("Artwork is missing. Re-upload it before saving.")
    const response = await fetch("/app/api/binder-appearance/upload", { method: "POST", credentials: "same-origin", signal: AbortSignal.timeout(15000), headers: { "Content-Type": "application/json", "X-Binder-Owner": owner }, body: JSON.stringify({ id, mimeType: blob.type, size: blob.size }) })
    const upload = await responseData(response) as { exists?: boolean; path?: string; token?: string }
    if (!upload.exists) {
      if (!upload.path || !upload.token) throw new Error("Could not prepare the artwork upload.")
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const { error } = await Promise.race([
          createClient().storage.from("binder-artwork").uploadToSignedUrl(upload.path, upload.token, blob, { contentType: blob.type }),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Artwork upload timed out. Your draft is saved on this device.")), 15000) }),
        ])
        if (error) throw new Error("Artwork upload failed. Your draft is saved on this device.")
      } finally { clearTimeout(timer) }
    }
  }
  const response = await fetch("/app/api/binder-appearance", { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Binder-Owner": owner }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ design: snapshot.design, baseRevision: snapshot.revision }) })
  if (response.status === 409) {
    const latest = normalizeRemoteAppearance(await response.json(), owner)
    // A lost acknowledgement can leave a queued save that already committed.
    if (JSON.stringify(latest.design) === JSON.stringify(normalizeBinderDesign(snapshot.design))) return latest
    throw new AppearanceConflict()
  }
  return normalizeRemoteAppearance(await responseData(response), owner)
}
