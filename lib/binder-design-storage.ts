import { DESIGN_SURFACES, normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"
export interface SavedBinderDesign { design: BinderDesign; uploads: Record<string, Blob>; revision: number; pending: boolean }
const DB = "binderdex-appearance"
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore("designs")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error("Device storage is unavailable. Your draft is still here."))
    request.onblocked = () => reject(new Error("Close other studio tabs to enable device storage."))
  })
}
export async function readBinderDesign(owner: string): Promise<SavedBinderDesign | null> {
  const db = await openDatabase()
  try { return await new Promise((resolve, reject) => {
    const transaction = db.transaction("designs", "readonly"), request = transaction.objectStore("designs").get(owner)
    request.onsuccess = () => {
      const value = request.result
      if (!value) { resolve(null); return }
      const uploads: Record<string, Blob> = {}
      for (const [id, blob] of Object.entries(value.uploads ?? {})) if (/^upload:[a-z0-9-]+$/i.test(id) && blob instanceof Blob && blob.size <= 5 * 1024 * 1024 && /^image\/(png|jpeg|webp)$/.test(blob.type)) uploads[id] = blob
      resolve({ design: normalizeBinderDesign(value.design), uploads, revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0, pending: value.pending === true })
    }
    request.onerror = () => reject(new Error("Could not read your saved appearance."))
  }) } finally { db.close() }
}
export async function saveBinderDesign(owner: string, design: BinderDesign, uploads: Record<string, Blob>, sync = { revision: 0, pending: false }) {
  const normalized = normalizeBinderDesign(design), retained: Record<string, Blob> = {}
  for (const s of DESIGN_SURFACES) {
    const id = normalized.surfaces[s].artwork
    if (id?.startsWith("upload:")) {
      if (!uploads[id]) throw new Error("Artwork is missing. Re-upload it before saving.")
      retained[id] = uploads[id]
    }
  }
  const db = await openDatabase()
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("designs", "readwrite")
    tx.objectStore("designs").put({ design: normalized, uploads: retained, revision: sync.revision, pending: sync.pending }, owner)
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(new Error("Could not save on this device. Your previous appearance and current draft are unchanged."))
  }) } finally { db.close() }
}
export async function removeBinderDesign(owner: string) {
  const db = await openDatabase()
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("designs", "readwrite")
    transaction.objectStore("designs").delete(owner)
    transaction.oncomplete = () => resolve()
    transaction.onerror = transaction.onabort = () => reject(new Error("Could not clear the device appearance. Your draft is still here."))
  }) } finally { db.close() }
}
export async function validateArtwork(file: File): Promise<void> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPEG or WebP image under 5 MB.")
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("This image could not be opened. Try another file.") })
  try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 24_000_000) throw new Error("Choose an image smaller than 24 megapixels.") } finally { bitmap.close() }
}
