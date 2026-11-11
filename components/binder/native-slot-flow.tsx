"use client"

import { useEffect, useState, type ComponentProps } from "react"
import SlotDetail from "@/components/binder/slot-detail"
import { CardSelector } from "@/components/binder/lazy-views"
import NativePickQuestion from "@/components/binder/native-pick-question"
import { useNativeSlotPick } from "@/hooks/use-native-slot-pick"
import type { BinderDisplaySlot } from "@/lib/binder-display-model"
import type { PricingRegion } from "@/lib/pricing-region"
import { speciesSelectorCard, type SlotPickerBoundary } from "@/lib/slot-picker"
import { displaySlotName } from "@/lib/pocket-labels"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"

type SelectorPricing = Pick<ComponentProps<typeof CardSelector>, "defaultCardLanguage" | "formatAmount"> & { pricingRegion: PricingRegion }

/** Selection only reads the value; the selector's legacy collection write is never reached in native mode. */
const unusedLegacySelect = () => {}

/**
 * What a tap on a native pocket opens. An editable empty pocket always opens the existing visual card selector:
 * a Pokémon pocket lists that Pokémon's cards, a pocket reserved for one printing shows that printing, and a free
 * pocket searches every card. The pick (and variant) is saved headlessly through the native durable sink and the
 * selector closes back onto the binder. Owned and read-only pockets open the card's details.
 * Mounted per tapped slot (keyed by the host).
 */
export default function NativeSlotFlow({ pricing, ...detail }: ComponentProps<typeof SlotDetail> & { pricing: SelectorPricing }) {
  const { slot, picker, onClose } = detail
  // Decided once from the pocket as it was tapped; a pocket filled meanwhile falls back to its details.
  const [choosing] = useState(() => Boolean(picker && !slot.item))
  const selecting = choosing && picker && !slot.item
  useEffect(() => {
    if (!selecting) return
    window.addEventListener("offline", onClose)
    return () => window.removeEventListener("offline", onClose)
  }, [selecting, onClose])
  if (selecting) return <PocketSelector boundary={picker} slot={slot} pricing={pricing} onClose={onClose} />
  return <SlotDetail {...detail} />
}

function PocketSelector({ boundary, slot, pricing, onClose }: { boundary: SlotPickerBoundary; slot: BinderDisplaySlot; pricing: SelectorPricing; onClose: () => void }) {
  const save = useNativeSlotPick(boundary, onClose)
  const species = slot.target?.kind !== "card" ? slot.pokemon : null
  const reserved = slot.target?.kind === "card" ? slot.target : null
  return <>
    <CardSelector pokemonId={species?.id ?? 0} pokemonName={species ? displaySlotName({ card: null, pokemon: species, target: null }) : ""} onSelect={unusedLegacySelect} onClose={onClose}
      selectedWantedCardId={slot.wantedCards[0]?.card_id} {...pricing} defaultCardLanguage={reserved?.language ?? pricing.defaultCardLanguage}
      anyCard={species ? undefined : reserved ? { title: `Add ${displaySlotName(slot)}`, cardId: reserved.cardId } : { title: "Add a card" }}
      native={{ onPick: (card, finish) => save.pick(species ? speciesSelectorCard(card, species.id) : { ...card, dexIds: card.dexIds ?? [] } as SearchCardResult, finish) }} />
    {save.question && <NativePickQuestion question={save.question} onClose={save.dismiss} />}
  </>
}
