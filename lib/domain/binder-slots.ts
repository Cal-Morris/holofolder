import { matchesCatalogCardId } from "@/lib/card-catalog"
import { isCardFinish, isCardLanguage, type CardCatalogIdentity, type CardFinish, type CardLanguage } from "@/lib/domain/cards"

export type SlotTarget =
  | { kind: "pokemon"; pokemonId: number }
  | { kind: "card"; cardId: string; language?: CardLanguage; finish?: CardFinish }

/** Identity evidence supplied by the catalog or an inventory adapter, never inferred from a card name. */
export type SlotTargetCandidate =
  | (CardCatalogIdentity & { kind: "card"; id: string; pokemonIds: readonly number[]; language?: CardLanguage; finish?: CardFinish })
  | { kind: "pokemon"; pokemonId: number }

/** Null is intentionally free; undefined rejects malformed input instead of removing a constraint. */
export function normalizeSlotTarget(value: unknown): SlotTarget | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const target = value as Record<string, unknown>
  if (target.kind === "pokemon") {
    if (Object.keys(target).some(key => key !== "kind" && key !== "pokemonId")) return undefined
    if (typeof target.pokemonId !== "number" || !Number.isSafeInteger(target.pokemonId) || target.pokemonId <= 0) return undefined
    return { kind: "pokemon", pokemonId: target.pokemonId }
  }
  if (target.kind !== "card") return undefined
  if (Object.keys(target).some(key => !["kind", "cardId", "language", "finish"].includes(key))) return undefined
  if (typeof target.cardId !== "string" || !target.cardId || target.cardId !== target.cardId.trim() || target.cardId.length > 200) return undefined
  if ("language" in target && !isCardLanguage(target.language)) return undefined
  if ("finish" in target && !isCardFinish(target.finish)) return undefined
  return {
    kind: "card",
    cardId: target.cardId,
    ...(isCardLanguage(target.language) ? { language: target.language } : {}),
    ...(isCardFinish(target.finish) ? { finish: target.finish } : {}),
  }
}

/** Inputs must already be validated. Matching never changes ownership or satisfies another slot. */
export function matchesSlotTarget(candidate: SlotTargetCandidate, target: SlotTarget | null): boolean {
  if (target === null) return true
  if (target.kind === "pokemon") {
    return candidate.kind === "pokemon"
      ? candidate.pokemonId === target.pokemonId
      : candidate.pokemonIds.includes(target.pokemonId)
  }
  if (candidate.kind !== "card" || !matchesCatalogCardId(candidate, target.cardId)) return false
  return (target.language === undefined || target.language === candidate.language)
    && (target.finish === undefined || target.finish === candidate.finish)
}
