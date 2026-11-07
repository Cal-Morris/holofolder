import { matchesCatalogCardId } from "@/lib/card-catalog"
import { normalizeCardFinish, normalizeCardLanguage, type CardFinish, type CollectedPokemon } from "@/lib/domain/cards"
import type { AllBindersLookup } from "@/lib/binders/all-binders"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

export interface QuickCardState {
  owned: boolean
  wanted: boolean
  ownedElsewhere?: string[]
  replacing?: string | null
  otherBindersIncomplete?: boolean
}

export function getQuickCardState(card: SearchCardResult, item: CollectedPokemon | null | undefined, finish: CardFinish | undefined, lookup?: AllBindersLookup | null, currentBinderId?: string | null): QuickCardState {
  const matches = (entry: { card_id?: string; card_language?: unknown; card_finish?: unknown }, matchFinish = true) => Boolean(entry.card_id)
    && matchesCatalogCardId(card, entry.card_id!)
    && normalizeCardLanguage(entry.card_language) === normalizeCardLanguage(card.language)
    && (!matchFinish || finish === undefined || normalizeCardFinish(entry.card_finish) === finish)
  const hasOwnedPrinting = (entry: CollectedPokemon) => Boolean(entry.card_id) && entry.status !== "wishlisted"
  const owned = Boolean(item && hasOwnedPrinting(item) && matches(item))
  return {
    owned,
    wanted: Boolean(item?.wanted_cards.some(entry => matches(entry))),
    ownedElsewhere: lookup?.binders.filter(binder => binder.id !== currentBinderId
      && lookup.collections.get(binder.id)?.some(entry => hasOwnedPrinting(entry) && matches(entry))).map(binder => binder.name) ?? [],
    replacing: item && hasOwnedPrinting(item) && !owned ? item.card_name || item.card_id! : null,
    otherBindersIncomplete: !lookup || lookup.binders.some(binder => !lookup.loadedBinderIds?.includes(binder.id)),
  }
}
