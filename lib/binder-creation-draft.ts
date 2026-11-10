import { isCompleteInventorySnapshot } from "@/lib/collection/slot-snapshot"
import { getStoragePresentationDefault, type StorageKind, type InventorySnapshot } from "@/lib/domain/inventory"
import type { OperationIntentContext } from "@/lib/domain/audit-context"
import { parseSlotIntent } from "@/lib/collection/slot-optimistic"
import { parseSetChecklist } from "@/lib/set-preset"
import { normalizePresetManifest, type PresetDefinition, type SetChecklist } from "@/lib/domain/binder-presets"
import { isContractRecord, isSlotContractId, type SlotTarget } from "@/lib/domain/binder-slots"
import { normalizeBinderName } from "@/lib/binders/model"
import { isCardLanguage } from "@/lib/domain/cards"
import { POKEMON_CATALOG } from "@/lib/pokemon-catalog"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { SLOT_LIMITS } from "@/lib/domain/slot-commands"

export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T
export type BinderCreationDraft = Immutable<{ version: 1; operationId: string; ownerUserId: string; name: string; kind: Exclude<StorageKind, "slab">; location: string | null; manifest: PresetDefinition; setChecklist?: SetChecklist }>

/** UI-only draft, deliberately not a durable command or an offline queue entry. */
export function parseBinderCreationDraft(value: unknown): BinderCreationDraft {
  if (!isContractRecord(value, ["version", "operationId", "ownerUserId", "name", "manifest", "setChecklist", "kind", "location"])
    || value.version !== 1 || !isSlotContractId(value.operationId) || !isSlotContractId(value.ownerUserId)) throw new Error("Invalid creation draft")
  const name = normalizeBinderName(value.name), manifest = normalizePresetManifest(value.manifest)
  if (!name || !manifest || manifest.entries.length > SLOT_LIMITS.capacity) throw new Error("Invalid creation draft")
  const kind = value.kind === undefined ? "binder" : value.kind
  if (kind !== "binder" && kind !== "custom") throw new Error("Invalid storage kind")
  if (value.location !== undefined && value.location !== null && typeof value.location !== "string") throw new Error("Invalid storage location")
  const location = typeof value.location === "string" ? value.location.trim() || null : null
  if (location !== null && (kind !== "custom" || !isSlotContractId(location))) throw new Error("Invalid storage location")
  const setChecklist = value.setChecklist === undefined ? undefined : parseSetChecklist(value.setChecklist)
  if (setChecklist && JSON.stringify(setChecklist.manifest) !== JSON.stringify(manifest)) throw new Error("Set scope does not match creation draft")
  return freeze({ ...(setChecklist ? { setChecklist } : {}), version: 1 as const, operationId: value.operationId, ownerUserId: value.ownerUserId, name, kind, location, manifest })
}
function freeze<T extends object>(value: T): Immutable<T> {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child)
  return Object.freeze(value) as Immutable<T>
}

export function speciesPreset(name: string, ids: readonly number[], sourceId = "selected-species"): PresetDefinition {
  if (new Set(ids).size !== ids.length || ids.some(id => !POKEMON_CATALOG.some(p => p.id === id))) throw new Error("Choose known species once each")
  return { source: { id: sourceId, version: "1" }, name,
    entries: ids.map(pokemonId => ({ id: `pokemon-${pokemonId}`, target: { kind: "pokemon", pokemonId } })) }
}
export function blankPreset(): PresetDefinition {
  return { source: { id: "blank", version: "1" }, name: "Blank", entries: [] }
}
/** Require catalog evidence; unknown language is not silently inferred as English. */
export function printingTarget(card: SearchCardResult): Extract<SlotTarget, { kind: "card" }> | undefined {
  if (!isSlotContractId(card.id) || !isSlotContractId(card.set?.id) || !card.localId || !isCardLanguage(card.language)) return undefined
  return { kind: "card", cardId: card.canonicalId ?? card.id, language: card.language }
}
export function printingPreset(cards: readonly SearchCardResult[]): PresetDefinition {
  const targets = cards.map(printingTarget)
  if (targets.some(t => !t)) throw new Error("A printing needs catalog, set and language evidence")
  return { source: { id: "selected-printings", version: "1" }, name: "Selected printings",
    entries: targets.map((target, index) => ({ id: `printing-${index + 1}`, target: target! })) }
}

/** Allocate IDs/time before calling this once, then retain these exact bytes through local aborts. */
export function prepareBinderCreation(draft: BinderCreationDraft, base: InventorySnapshot, context: OperationIntentContext,
  collectionId: string, slotIds: string[], grid: { rows: number; cols: number } | null = null) {
  if (!isCompleteInventorySnapshot(base) || base.ownerUserId !== draft.ownerUserId) throw new Error("verified-complete-native-base-required")
  if (draft.setChecklist) throw new Error("set-checklist-persistence-unavailable")
  if (context.operationId !== draft.operationId) throw new Error("operation-id-mismatch")
  const intent = parseSlotIntent({ kind: "creation", context, request: { version: 1, operationId: draft.operationId,
    inventoryRevision: base.inventoryRevision, collectionId, slotIds, name: draft.name,
    kind: draft.kind, defaultPresentation: getStoragePresentationDefault(draft.kind), location: draft.location, grid, manifest: draft.manifest } })
  freeze(intent)
  return intent
}
