"use client"

import { useEffect, useState, type ComponentProps } from "react"
import SlotDetail from "@/components/binder/slot-detail"
import { CardSelector } from "@/components/binder/lazy-views"
import NativePickQuestion from "@/components/binder/native-pick-question"
import type { SlotPickerBoundary } from "@/components/binder/slot-picker"
import { useNativeSlotPick } from "@/hooks/use-native-slot-pick"
import type { PricingRegion } from "@/lib/pricing-region"
import { speciesSelectorCard } from "@/lib/slot-picker"
import { formatPokemonDisplayName } from "@/lib/pokemon-catalog"

type SelectorPricing = Pick<ComponentProps<typeof CardSelector>, "defaultCardLanguage" | "formatAmount"> & { pricingRegion: PricingRegion }

/** Selection only reads the value; the selector's legacy collection write is never reached in native mode. */
const unusedLegacySelect = () => {}

/**
 * What a tap on a native pocket opens. An editable empty species pocket opens the existing card selector; its
 * pick (and variant) is saved headlessly through the native durable sink and the selector closes. Free and
 * printing pockets search the catalog inside the slot sheet with the same save. Owned, read-only and
 * layout-editing pockets keep the card-first detail. Mounted per tapped slot (keyed by the host).
 */
export default function NativeSlotFlow({ pricing, ...detail }: ComponentProps<typeof SlotDetail> & { pricing: SelectorPricing }) {
  const { slot, picker, layout, onClose } = detail
  // Decided once from the pocket as it was tapped; a pocket filled meanwhile falls back to its detail.
  const [species] = useState(() => Boolean(picker && !layout && !slot.item && slot.pokemon))
  const selecting = species && picker && !slot.item && slot.pokemon
  useEffect(() => {
    if (!selecting) return
    window.addEventListener("offline", onClose)
    return () => window.removeEventListener("offline", onClose)
  }, [selecting, onClose])
  if (selecting) return <SpeciesSelector boundary={picker} pokemonId={slot.pokemon!.id} pokemonName={slot.pokemon!.name} wantedCardId={slot.wantedCards[0]?.card_id} pricing={pricing} onClose={onClose} />
  return <SlotDetail {...detail} />
}

function SpeciesSelector({ boundary, pokemonId, pokemonName, wantedCardId, pricing, onClose }: { boundary: SlotPickerBoundary; pokemonId: number; pokemonName: string; wantedCardId?: string; pricing: SelectorPricing; onClose: () => void }) {
  const save = useNativeSlotPick(boundary, onClose)
  return <>
    <CardSelector pokemonId={pokemonId} pokemonName={formatPokemonDisplayName(pokemonName)} onSelect={unusedLegacySelect} onClose={onClose}
      selectedWantedCardId={wantedCardId} {...pricing} native={{ onPick: (card, finish) => save.pick(speciesSelectorCard(card, pokemonId), finish) }} />
    {save.question && <NativePickQuestion question={save.question} onClose={save.dismiss} />}
  </>
}
