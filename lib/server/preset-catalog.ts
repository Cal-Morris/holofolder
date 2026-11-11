import type { SupabaseClient } from "@supabase/supabase-js"
import type { z } from "zod"
import type { presetPreviewInput } from "@/lib/developer-api/presets"
import { PRESET_PREVIEW_LIMITS as limits } from "@/lib/developer-api/presets"
import { DeveloperAccessError } from "@/lib/developer-api/permissions"
import { readCatalogMetadata } from "@/lib/card-catalog"
import { isSlotContractId } from "@/lib/domain/binder-slots"
import { printingPreset } from "@/lib/binder-creation-draft"
import { SET_FINISH_FLAGS, type SetPresetFinish } from "@/lib/set-preset"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

type Printing = NonNullable<z.infer<typeof presetPreviewInput>["printings"]>[number]
type Row = Record<string, unknown>
const unavailable = (): never => { throw new DeveloperAccessError("preset_catalog_unavailable", "Exact unambiguous catalog, language and requested finish evidence is required. No partial preview was returned.", 422) }
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}

/** Public mirror only, never a provider request or an owner/planning-state read. */
export async function readPresetPrintings(db: SupabaseClient, printings: Printing[], signal: AbortSignal, check: () => void, account: (value: unknown) => void) {
  const ids = [...new Set(printings.map(p => p.cardId))].sort()
  if (!ids.length) return printingPreset([])
  if (ids.length > limits.uniquePrintings) throw new DeveloperAccessError("preset_scope_too_large", "Select at most 25 unique mirrored printings.", 400)
  const read = async (table: string, select: string, filter: (q: ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => ReturnType<ReturnType<SupabaseClient["from"]>["select"]>) => {
    const result: Row[] = []
    let after: string | null = null
    do {
      check()
      let q = filter(db.from(table).select(select)).order("id").limit(limits.pageSize)
      if (after !== null) q = q.gt("id", after)
      const response = await q.abortSignal(signal)
      if (response.error || !Array.isArray(response.data) || response.data.length > limits.pageSize) return unavailable()
      account(response.data)
      const page = response.data as unknown as Row[]
      for (const row of page) {
        if (!isSlotContractId(row.id) || result.some(r => r.id === row.id) || after !== null && row.id <= after) return unavailable()
        result.push(row)
      }
      after = page.length === limits.pageSize ? String(page.at(-1)!.id) : null
    } while (after !== null)
    return result
  }
  const select = "id,set_id,local_id,name_json,variants_json,external_ids_json"
  const cards = await read("tcg_cards", select, q => q.in("id", ids))
  if (cards.length !== ids.length || cards.some(c => !ids.includes(String(c.id)))) return unavailable()
  // A direct ID must not also identify a different mirrored row via an alias/canonical mapping.
  for (const id of ids) {
    const aliases = await read("tcg_cards", select, q => q.contains("external_ids_json->catalog->aliasIds", JSON.stringify([id])))
    const canonical = await read("tcg_cards", select, q => q.eq("external_ids_json->catalog->>canonicalId", id))
    if ([...aliases, ...canonical].some(c => c.id !== id)) return unavailable()
    if (aliases.some(c => !readCatalogMetadata(c.external_ids_json).aliasIds?.includes(id))
      || canonical.some(c => readCatalogMetadata(c.external_ids_json).canonicalId !== id)) return unavailable()
  }
  const setIds = [...new Set(cards.map(c => String(c.set_id)))]
  const sets = await read("tcg_sets", "id,name_en", q => q.in("id", setIds))
  if (sets.length !== setIds.length || sets.some(s => !setIds.includes(String(s.id)))) return unavailable()
  const evidence: SearchCardResult[] = printings.map(p => {
    const card = cards.find(c => c.id === p.cardId)!, metadata = readCatalogMetadata(card.external_ids_json)
    const rawMetadata = record(record(card.external_ids_json).catalog)
    if (Object.hasOwn(rawMetadata, "canonicalId") && rawMetadata.canonicalId !== metadata.canonicalId
      || Object.hasOwn(rawMetadata, "aliasIds") && !metadata.aliasIds) return unavailable()
    const set = sets.find(s => s.id === card.set_id), name = record(card.name_json)[p.language]
    if (!isSlotContractId(card.local_id) || !set || !isSlotContractId(set.id) || !isSlotContractId(set.name_en)
      || !isSlotContractId(name) || metadata.canonicalId && metadata.canonicalId !== p.cardId) return unavailable()
    if (p.finish && (!Object.hasOwn(SET_FINISH_FLAGS, p.finish)
      || record(card.variants_json)[SET_FINISH_FLAGS[p.finish as SetPresetFinish]] !== true)) return unavailable()
    return { id: p.cardId, localId: card.local_id, name, language: p.language, set: { id: set.id, name: set.name_en }, dexIds: [] }
  })
  const manifest = printingPreset(evidence)
  manifest.entries.forEach((entry, index) => {
    const finish = printings[index].finish
    if (finish && entry.target?.kind === "card") entry.target.finish = finish
  })
  return manifest
}
