import { DESIGN_SURFACES, normalizeBinderDesign, type BinderDesign } from "@/lib/binder-design"
import { IMPORT_MAX_BYTES } from "@/lib/collection-import"
import { isContractRecord } from "@/lib/domain/binder-slots"
import type { BinderSnapshot, BinderSlot } from "@/lib/domain/binder-slots"
import { normalizeInventorySnapshot, type InventorySnapshot, type InventoryItem, type StorageCollection } from "@/lib/domain/inventory"
import type { WantedCard } from "@/lib/domain/cards"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"
import { getDefaultBinderSettings, normalizeBinderSettings, type BinderSettings } from "@/lib/settings"

const PORTABLE_OWNER = "portable"
export type PortableItem = Omit<InventoryItem, "ownerUserId">
export type PortableCollection = Omit<StorageCollection, "ownerUserId">
export type PortableWant = Omit<WantedCard, "wanted_by"> & { wantedRoles?: ("owner" | "partner")[] }
export type PortableBinder = Omit<BinderSnapshot, "ownerUserId" | "slots"> & { slots: (Omit<BinderSlot, "ownerUserId" | "wantedCards"> & { wantedCards: PortableWant[] })[] }
const ROLE_IDS = { owner: "00000000-0000-4000-8000-000000000001", partner: "00000000-0000-4000-8000-000000000002" } as const
export interface BackupAppearance { collectionId: string; settings: BinderSettings; design: BinderDesign }
export interface BinderBackupV2 {
  format: "holofolder-binder-backup"
  version: 2
  exportedAt: string
  scope: "collection" | "all-inventory"
  inventoryRevision: number
  items: PortableItem[]
  placements: InventorySnapshot["placements"]
  collections: PortableCollection[]
  binders: PortableBinder[]
  appearance: BackupAppearance[]
}

/** Stable content evidence, not a signature or authentication token. Array order is significant. */
export function backupContentKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(backupContentKey).join(",")}]`
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${backupContentKey(v)}`).join(",")}}`
  return JSON.stringify(value)
}
export function freezeBackupPlan<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeBackupPlan); Object.freeze(value) }
  return value
}
function invalid(reason = "Invalid v2 backup or cross-references"): never { throw new Error(reason) }
const withoutOwner = <T extends { ownerUserId: string }>({ ownerUserId: _owner, ...value }: T) => value

/** No network, artwork download, storage, authorization or write side effects. */
export function createBinderBackupV2(input: {
  snapshot: InventorySnapshot
  completeness: "complete-owner" | "partial"
  scope: BinderBackupV2["scope"]
  collectionId?: string
  appearance?: BackupAppearance[]
  partnerUserId?: string
}, now = new Date()): BinderBackupV2 {
  if (input.completeness !== "complete-owner") invalid("A complete authoritative owner snapshot is required; cached pages are incomplete")
  const source = normalizeInventorySnapshot(input.snapshot)
  if (!source) invalid()
  const collections = source.collections.filter(c => input.scope === "all-inventory" || c.id === input.collectionId)
  if (input.scope === "collection" && collections.length !== 1) invalid("Choose a collection")
  const selected = new Set(collections.map(c => c.id))
  const placements = source.placements.filter(p => selected.has(p.collectionId))
  const referenced = new Set(placements.map(p => p.inventoryItemId))
  const value: BinderBackupV2 = {
    format: "holofolder-binder-backup", version: 2, exportedAt: now.toISOString(), scope: input.scope,
    inventoryRevision: source.inventoryRevision,
    collections: collections.map(withoutOwner),
    binders: source.binders.filter(b => selected.has(b.collectionId)).map(b => ({ ...withoutOwner(b), slots: b.slots.map(s => ({ ...withoutOwner(s), wantedCards: s.wantedCards.map(w => {
      const { wanted_by, ...want } = w
      if (wanted_by?.some(id => id !== source.ownerUserId && id !== input.partnerUserId)) invalid("Resolve wanted-person membership before export")
      return { ...want, ...(wanted_by ? { wantedRoles: wanted_by.map(id => id === source.ownerUserId ? "owner" as const : "partner" as const) } : {}) }
    }) })) })),
    items: source.items.filter(i => input.scope === "all-inventory" || referenced.has(i.id)).map(withoutOwner),
    placements, appearance: structuredClone((input.appearance ?? []).filter(a => selected.has(a.collectionId))),
  }
  return parseBinderBackupV2(JSON.stringify(value))
}

export function parseBinderBackupV2(text: string): BinderBackupV2 {
  if (new TextEncoder().encode(text).length > IMPORT_MAX_BYTES) invalid("Maximum file size is 10 MiB")
  let raw: unknown
  try { raw = JSON.parse(text.replace(/^\uFEFF/, "")) } catch { return invalid("Invalid JSON backup") }
  if (!isContractRecord(raw, ["format", "version", "exportedAt", "scope", "inventoryRevision", "items", "placements", "collections", "binders", "appearance"])
    || raw.format !== "holofolder-binder-backup" || raw.version !== 2) invalid("Unsupported backup format or version")
  if (typeof raw.exportedAt !== "string" || !Number.isFinite(Date.parse(raw.exportedAt))
    || !["collection", "all-inventory"].includes(raw.scope as string)
    || !Array.isArray(raw.items) || raw.items.length > 5000
    || !Array.isArray(raw.placements) || raw.placements.length > 5000
    || !Array.isArray(raw.collections) || raw.collections.length > 32
    || !Array.isArray(raw.binders) || raw.binders.length > 32 || !Array.isArray(raw.appearance)) invalid()
  if (raw.scope === "collection" && raw.collections.length !== 1) invalid()
  // Strict portable fields are checked before injecting the placeholder owner for canonical validation.
  const owned = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || "ownerUserId" in value) return invalid()
    return { ...value, ownerUserId: PORTABLE_OWNER }
  }
  const snapshot = normalizeInventorySnapshot({ ownerUserId: PORTABLE_OWNER, inventoryRevision: raw.inventoryRevision,
    items: raw.items.map(owned), placements: raw.placements, collections: raw.collections.map(owned),
    binders: raw.binders.map(value => {
      const b = owned(value)
      if (!("slots" in b) || !Array.isArray(b.slots) || b.slots.length > SLOT_LIMITS.capacity) return invalid()
      return { ...b, slots: b.slots.map(slot => {
        const s = owned(slot)
        if (!("wantedCards" in s) || !Array.isArray(s.wantedCards)) return invalid()
        return { ...s, wantedCards: s.wantedCards.map(w => {
          if (!w || typeof w !== "object" || Array.isArray(w) || "wanted_by" in w) return invalid()
          const { wantedRoles, ...want } = w as Record<string, unknown>
          if (wantedRoles !== undefined && (!Array.isArray(wantedRoles) || wantedRoles.length > 2 || new Set(wantedRoles).size !== wantedRoles.length || wantedRoles.some(r => r !== "owner" && r !== "partner"))) return invalid()
          return { ...want, ...(Array.isArray(wantedRoles) ? { wanted_by: wantedRoles.map(r => ROLE_IDS[r as keyof typeof ROLE_IDS]) } : {}) }
        }) }
      }) }
    }),
  })
  if (!snapshot || snapshot.binders.some(b => (b.presetManifest?.entries.length ?? 0) > SLOT_LIMITS.capacity || b.slots.some(s => s.wantedCards.length > SLOT_LIMITS.wantsPerSlot))) invalid()
  if (raw.scope === "collection" && snapshot.items.length !== snapshot.placements.length) invalid("Collection exports contain only referenced items")
  const seenAppearance = new Set<string>()
  for (const a of raw.appearance) {
    if (!isContractRecord(a, ["collectionId", "settings", "design"]) || typeof a.collectionId !== "string"
      || !snapshot.collections.some(c => c.id === a.collectionId) || seenAppearance.has(a.collectionId)) invalid()
    seenAppearance.add(a.collectionId)
    if (backupContentKey(a.settings) !== backupContentKey(normalizeBinderSettings(a.settings as Parameters<typeof normalizeBinderSettings>[0], getDefaultBinderSettings()))
      || backupContentKey(a.design) !== backupContentKey(normalizeBinderDesign(a.design))) invalid("Unsupported appearance/settings")
    const design = a.design as BinderDesign
    if (DESIGN_SURFACES.some(s => design.surfaces[s].artwork !== null)) invalid("Artwork packaging requires #390; remove artwork explicitly before exporting")
  }
  for (const item of snapshot.items) if (item.grading?.label.assetIds.length) invalid("Private label asset packaging requires #390")
  // A portable file must not carry private URLs or credentials in wanted-card image fields.
  for (const b of snapshot.binders) for (const s of b.slots) for (const want of s.wantedCards) {
    if (want.card_image) {
      let url: URL
      try { url = new URL(want.card_image) } catch { return invalid("Unverified asset URL") }
      if (url.protocol !== "https:" || !["assets.tcgdex.net", "assets.holofolder.com"].includes(url.hostname)
        || url.username || url.password || url.port || url.search || url.hash) invalid("Unverified asset URL")
    }
  }
  return freezeBackupPlan(structuredClone(raw) as unknown as BinderBackupV2)
}

/** Internal bridge only. The owner comes from the trusted boundary, never the file. */
export function hydrateBackupSnapshot(backup: BinderBackupV2, ownerUserId: string, partnerUserId?: string): InventorySnapshot {
  const snapshot = normalizeInventorySnapshot({ ownerUserId, inventoryRevision: backup.inventoryRevision,
    items: backup.items.map(i => ({ ...i, ownerUserId })), placements: backup.placements,
    collections: backup.collections.map(c => ({ ...c, ownerUserId })),
    binders: backup.binders.map(b => ({ ...b, ownerUserId, slots: b.slots.map(s => ({ ...s, ownerUserId, wantedCards: s.wantedCards.map(w => {
      const { wantedRoles, ...want } = w
      if (wantedRoles?.includes("partner") && !partnerUserId) return invalid("Resolve current partner wanted assignment explicitly")
      return { ...want, ...(wantedRoles ? { wanted_by: wantedRoles.map(r => r === "owner" ? ownerUserId : partnerUserId!) } : {}) }
    }) })) })),
  })
  return snapshot ?? invalid()
}
