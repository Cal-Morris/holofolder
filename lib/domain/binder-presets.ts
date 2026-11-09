import {
  isContractRecord, isSlotContractId, normalizeSlotTarget,
  type BinderSnapshot, type SlotTarget,
} from "@/lib/domain/binder-slots"

export interface PresetSource {
  id: string
  version: string
}

export interface PresetDefinition {
  source: PresetSource
  name: string
  entries: { id: string; target: SlotTarget | null }[]
}

/** A detached copy of a definition, never a live catalog/preset subscription. */
export type PresetManifest = PresetDefinition

export function normalizePresetDefinition(value: unknown): PresetDefinition | undefined {
  if (!isContractRecord(value, ["source", "name", "entries"]) || !isContractRecord(value.source, ["id", "version"])
    || !isSlotContractId(value.source.id) || !isSlotContractId(value.source.version)
    || typeof value.name !== "string" || !value.name.trim() || !Array.isArray(value.entries)) return undefined
  const entries: PresetDefinition["entries"] = []
  const ids = new Set<string>()
  for (const entry of value.entries) {
    if (!isContractRecord(entry, ["id", "target"]) || !isSlotContractId(entry.id) || ids.has(entry.id)) return undefined
    const target = normalizeSlotTarget(entry.target)
    if (target === undefined) return undefined
    ids.add(entry.id)
    entries.push({ id: entry.id, target })
  }
  return { source: { id: value.source.id, version: value.source.version }, name: value.name, entries }
}

export function normalizePresetManifest(value: unknown): PresetManifest | undefined {
  return normalizePresetDefinition(value)
}

/** IDs are supplied by the caller so retries/offline creation can preserve the same identities. */
export function instantiatePreset(
  definition: PresetDefinition,
  scope: Pick<BinderSnapshot, "ownerUserId" | "collectionId">,
  slotIds: readonly string[],
): BinderSnapshot | undefined {
  const manifest = normalizePresetDefinition(definition)
  if (!manifest || !isContractRecord(scope, ["ownerUserId", "collectionId"]) || !isSlotContractId(scope.ownerUserId) || !isSlotContractId(scope.collectionId)
    || slotIds.length !== manifest.entries.length || Array.from(slotIds).some(id => !isSlotContractId(id))
    || new Set(slotIds).size !== slotIds.length) return undefined
  return {
    ownerUserId: scope.ownerUserId, collectionId: scope.collectionId, layoutRevision: 0, presetManifest: manifest,
    slots: manifest.entries.map((entry, index) => ({
      ownerUserId: scope.ownerUserId, collectionId: scope.collectionId, id: slotIds[index], target: normalizeSlotTarget(entry.target)!, inventoryItemId: null,
      wantedCards: [], status: null, version: 0,
      presetOrigin: { source: { ...manifest.source }, entryId: entry.id },
    })),
  }
}
