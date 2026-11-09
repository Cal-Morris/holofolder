import type { CardFinish, CardLanguage } from "@/lib/domain/cards"
import { isCardLanguage } from "@/lib/domain/cards"
import { isContractRecord, isSlotContractId, type BinderSnapshot } from "@/lib/domain/binder-slots"
import { normalizePresetManifest, type SetChecklist, type SetChecklistScope } from "@/lib/domain/binder-presets"
import type { TCGSetSlotCard, TCGSetSummary } from "@/lib/tcg-set-slots"

export const SET_FINISH_FLAGS = { normal: "normal", holo: "holo", reverse_holo: "reverse", jumbo: "jumbo" } as const
export type SetPresetFinish = keyof typeof SET_FINISH_FLAGS
const ordering = new Intl.Collator("en", { numeric: true, sensitivity: "base" })
export function compareCollectorNumbers(a: string, b: string) { return ordering.compare(a, b) || a.localeCompare(b, "en") }
export function verifiedSetFinishes(card: Pick<TCGSetSlotCard, "variants">): SetPresetFinish[] {
  return (Object.keys(SET_FINISH_FLAGS) as SetPresetFinish[]).filter(f => card.variants?.[SET_FINISH_FLAGS[f]] === true)
}
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === "object" && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b, "en"))) : child)
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}
export interface SetChecklistInput {
  set: TCGSetSummary
  cards: readonly Omit<TCGSetSlotCard, "inferredFinish">[]
  language: CardLanguage
  /** Empty means one finish-unconstrained target per card, never an inferred normal finish. */
  finishes: readonly CardFinish[]
  promos: readonly Omit<TCGSetSlotCard, "inferredFinish">[]
  excludedCardIds: readonly string[]
  capturedAt: string
}

export function generateSetChecklist(input: SetChecklistInput): SetChecklist {
  if (!isSlotContractId(input.set.id) || !isSlotContractId(input.set.name) || !isCardLanguage(input.language)
    || !isSlotContractId(input.capturedAt) || !Number.isFinite(Date.parse(input.capturedAt))) throw new Error("Invalid set scope")
  if (input.finishes.some(f => !Object.hasOwn(SET_FINISH_FLAGS, f)) || new Set(input.finishes).size !== input.finishes.length) throw new Error("Unsupported finish scope")
  const byId = new Map<string, SetChecklistScope["cards"][number]>()
  const promoCardIds: string[] = []
  const aliases = new Map<string, string>()
  for (const [cards, isPromo] of [[input.cards, false], [input.promos, true]] as const) {
    for (const card of cards) {
      const cardId = card.canonicalId ?? card.id
      if (![cardId, card.id, card.localId, card.name, card.set?.id].every(isSlotContractId)
        || !isPromo && card.set.id !== input.set.id) throw new Error("Invalid catalog identity")
      const copy = { cardId, setId: card.set.id, localId: card.localId, name: card.name,
        languageConfirmed: card.languageConfirmed === true && card.language === input.language,
        verifiedFinishes: verifiedSetFinishes(card) }
      const previous = byId.get(cardId)
      if (previous && JSON.stringify(previous) !== JSON.stringify(copy)) throw new Error("Conflicting duplicate catalog identity")
      byId.set(cardId, copy)
      for (const id of [card.id, cardId, ...(card.aliasIds ?? [])]) {
        if (aliases.has(id) && aliases.get(id) !== cardId) throw new Error("Conflicting catalog alias")
        aliases.set(id, cardId)
      }
      if (isPromo && !promoCardIds.includes(cardId)) promoCardIds.push(cardId)
    }
  }
  const excludedCardIds = [...new Set(input.excludedCardIds.map(id => {
    const canonical = aliases.get(id)
    if (!canonical) throw new Error("Unknown exclusion")
    return canonical
  }))].sort()
  const cards = [...byId.values()].sort((a, b) => Number(promoCardIds.includes(a.cardId)) - Number(promoCardIds.includes(b.cardId))
    || compareCollectorNumbers(a.localId, b.localId) || a.cardId.localeCompare(b.cardId))
  const entries = cards.flatMap((card, index) => {
    if (!card.languageConfirmed || excludedCardIds.includes(card.cardId)) return []
    const base = { kind: "card" as const, cardId: card.cardId, language: input.language }
    return input.finishes.length ? input.finishes.filter(f => card.verifiedFinishes.includes(f)).map(finish => ({ id: `target-${index + 1}-${finish}`, target: { ...base, finish } }))
      : [{ id: `target-${index + 1}`, target: base }]
  })
  const officialCardCount = input.set.officialCardCount ?? null
  if (officialCardCount !== null && (!Number.isSafeInteger(officialCardCount) || officialCardCount < 0)) throw new Error("Invalid catalog count")
  const warnings = ["Catalog coverage only. Secrets and subsets present in this list are included; missing cards, languages and variant families may exist. This is not a complete master-set claim."]
  if (officialCardCount !== null) warnings.push(`${cards.filter(c => !promoCardIds.includes(c.cardId)).length} catalog rows; printed base count ${officialCardCount} is not a master-set denominator.`)
  const unavailableLanguage = cards.filter(c => !c.languageConfirmed).length
  if (unavailableLanguage) warnings.push(`${unavailableLanguage} cards unavailable: chosen language is not confirmed in this catalog snapshot.`)
  if (input.finishes.length) warnings.push("Only explicitly true variant flags are eligible. False, absent and unknown flags are unavailable; rarity, price and grade supply no evidence.")
  for (const finish of input.finishes) {
    const eligible = cards.filter(c => c.languageConfirmed && !excludedCardIds.includes(c.cardId))
    const verified = eligible.filter(c => c.verifiedFinishes.includes(finish)).length
    warnings.push(`${finish}: ${verified} verified targets of ${eligible.length} included language-confirmed cards; ${eligible.length - verified} unavailable. Flags describe catalog evidence, not guaranteed regional distribution.`)
  }
  const scope: SetChecklistScope = { setId: input.set.id, setName: input.set.name, language: input.language,
    finishes: [...input.finishes], capturedAt: input.capturedAt, officialCardCount, cards, promoCardIds, excludedCardIds, warnings }
  const manifest = normalizePresetManifest({ source: { id: `set:${input.set.id}`, version: input.capturedAt }, name: input.set.name, entries })
  if (!manifest) throw new Error("Invalid copied set manifest")
  return freeze({ manifest, scope })
}

/** Rebuild and compare derived fields so an untrusted draft cannot detach its scope from its targets. */
export function parseSetChecklist(value: unknown): SetChecklist {
  if (!isContractRecord(value, ["manifest", "scope"]) || !isContractRecord(value.scope, ["setId", "setName", "language", "finishes", "capturedAt", "officialCardCount", "cards", "promoCardIds", "excludedCardIds", "warnings"])) throw new Error("Invalid set scope")
  const s = value.scope
  if (!isSlotContractId(s.setId) || !isSlotContractId(s.setName) || !isCardLanguage(s.language) || !isSlotContractId(s.capturedAt)
    || !(s.officialCardCount === null || typeof s.officialCardCount === "number" && Number.isSafeInteger(s.officialCardCount) && s.officialCardCount >= 0)
    || !Array.isArray(s.cards) || !Array.isArray(s.finishes) || !Array.isArray(s.promoCardIds) || !s.promoCardIds.every(isSlotContractId)
    || !Array.isArray(s.excludedCardIds) || !s.excludedCardIds.every(isSlotContractId) || !Array.isArray(s.warnings)) throw new Error("Invalid set scope")
  const cards: Omit<TCGSetSlotCard, "inferredFinish">[] = s.cards.map(c => {
    if (!isContractRecord(c, ["cardId", "setId", "localId", "name", "languageConfirmed", "verifiedFinishes"])
      || ![c.cardId, c.setId, c.localId, c.name].every(isSlotContractId) || typeof c.languageConfirmed !== "boolean"
      || !Array.isArray(c.verifiedFinishes) || c.verifiedFinishes.some(f => typeof f !== "string" || !Object.hasOwn(SET_FINISH_FLAGS, f))) throw new Error("Invalid set scope card")
    return { id: c.cardId as string, localId: c.localId as string, name: c.name as string, set: { id: c.setId as string, name: c.setId as string },
      language: s.language as CardLanguage, languageConfirmed: c.languageConfirmed,
      variants: Object.fromEntries(c.verifiedFinishes.map(f => [SET_FINISH_FLAGS[f as SetPresetFinish], true])) }
  })
  const promoIds = s.promoCardIds as string[]
  if (promoIds.some(id => !cards.some(c => c.id === id))) throw new Error("Invalid promo scope")
  const rebuilt = generateSetChecklist({ set: { id: s.setId, name: s.setName, ...(s.officialCardCount === null ? {} : { officialCardCount: s.officialCardCount }) },
    cards: cards.filter(c => !promoIds.includes(c.id)), promos: cards.filter(c => promoIds.includes(c.id)), language: s.language,
    finishes: s.finishes as CardFinish[], excludedCardIds: s.excludedCardIds as string[], capturedAt: s.capturedAt })
  const manifest = normalizePresetManifest(value.manifest)
  // Canonical serialization also keeps the copied preview stable across offline reopens.
  if (!manifest || stableJson(manifest) !== stableJson(rebuilt.manifest)
    || stableJson(s) !== stableJson(rebuilt.scope)) throw new Error("Set scope does not match copied manifest")
  return rebuilt
}

/** Compare the edited goal, not original-set missing cards; free extras and reordering do not alter it. */
export function isSetChecklistCustomised(checklist: SetChecklist, binder: BinderSnapshot): boolean {
  const targets = (entries: readonly { target: unknown }[]) => entries.filter(e => e.target !== null).map(e => stableJson(e.target)).sort()
  return JSON.stringify(targets(checklist.manifest.entries)) !== JSON.stringify(targets(binder.slots))
}
