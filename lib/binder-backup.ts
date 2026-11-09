import type { BinderBackupV2 } from "@/lib/binder-backup-v2"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { isCardFinish, isCardLanguage, isSlotStatus, type CollectedPokemon } from "@/lib/domain/cards"
import { normalizeBinderDesign, DESIGN_SURFACES, type BinderDesign } from "@/lib/binder-design"
import type { Binder } from "@/lib/binders/model"
import { getDefaultBinderSettings, normalizeBinderSettings, type BinderSettings } from "@/lib/settings"

export interface BinderBackupInput {
  binderId: string | null
  binder: Binder | null
  collection: readonly CollectedPokemon[]
  settings: BinderSettings
  design: BinderDesign
  uploads: Record<string, Blob>
}

/** Snapshot only the active binder's live state, never storage, session data or the sync queue. */
export async function createBinderBackup(input: BinderBackupInput, now = new Date()) {
  if (input.binder && input.binder.id !== input.binderId) throw new Error("The binder changed. Reopen Settings and try again.")
  const collection = input.collection.map(item => {
    const cards = [item, ...item.wanted_cards]
    if (!isSlotStatus(item.status) || !Number.isInteger(item.pokemon_id) || item.pokemon_id <= 0
      || cards.some(card => (card.card_finish !== undefined && !isCardFinish(card.card_finish))
        || (card.card_language !== undefined && !isCardLanguage(card.card_language)))) {
      throw new Error("This binder contains unsupported card data. Update the app before making a backup.")
    }
    return normalizeCollectionItem(item)
  })
  const settings = normalizeBinderSettings(input.settings, getDefaultBinderSettings())
  // Copy before reading artwork asynchronously, so later edits cannot change this snapshot.
  const snapshot = structuredClone({
    format: "holofolder-binder-backup" as const,
    version: 1 as const,
    exportedAt: now.toISOString(),
    scope: "current-binder" as const,
    binder: {
      id: input.binderId,
      name: input.binder?.name ?? null,
      color: input.binder?.color ?? null,
      rows: input.binder?.rows ?? null,
      cols: input.binder?.cols ?? null,
      isDefault: input.binder?.isDefault ?? null,
    },
    settings,
    design: normalizeBinderDesign(input.design),
    collection,
  })
  const artwork: Record<string, { mimeType: string; base64: string }> = {}
  const missingArtwork: string[] = []
  for (const id of new Set(DESIGN_SURFACES.map(surface => snapshot.design.surfaces[surface].artwork).filter((ref): ref is string => Boolean(ref?.startsWith("upload:"))))) {
    const blob = input.uploads[id]
    if (!blob) { missingArtwork.push(id); continue }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    artwork[id] = { mimeType: blob.type, base64: btoa(binary) }
  }
  return { ...snapshot, artwork, missingArtwork }
}

export function binderBackupFilename(name: string | null, exportedAt: string) {
  const slug = (name ?? "binder").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "") || "binder"
  return `holofolder-${slug}-${new Date(exportedAt).toISOString().replace(/[:.]/g, "-")}.json`
}

export function downloadBinderBackup(backup: Awaited<ReturnType<typeof createBinderBackup>> | BinderBackupV2) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + "\n"], { type: "application/json" }))
  const link = document.createElement("a")
  link.href = url
  link.download = binderBackupFilename(backup.version === 1 ? backup.binder.name : backup.collections[0]?.name ?? "inventory", backup.exportedAt)
  try {
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Give Safari time to start reading the file before releasing it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
