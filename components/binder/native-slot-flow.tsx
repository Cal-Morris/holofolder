"use client"

import { useState, type ComponentProps } from "react"
import SlotDetail from "@/components/binder/slot-detail"
import { CardSelector } from "@/components/binder/lazy-views"
import type { SlotPickerFlow } from "@/components/binder/slot-picker"
import type { CardFinish } from "@/lib/domain/cards"
import type { PricingRegion } from "@/lib/pricing-region"
import type { SearchCardResult } from "@/lib/pokemon-card-browse"
import { speciesSelectorCard } from "@/lib/slot-picker"

type Stage = { kind: "detail" | "pick" | "search" | "edit" } | { kind: "chosen"; card: SearchCardResult; finish?: CardFinish }
type SelectorPricing = Pick<ComponentProps<typeof CardSelector>, "defaultCardLanguage" | "formatAmount"> & { pricingRegion: PricingRegion }

/** Selection only reads the value; the selector's legacy collection write is never reached in native mode. */
const unusedLegacySelect = () => {}

/**
 * What a tap on a native pocket opens. An editable empty pocket goes straight to choosing a card: the species
 * card selector for a Pokémon target, catalog search otherwise. Owned, read-only and layout-editing pockets keep
 * the card-first detail. The pick is saved by the slot picker's existing command path, never by the selector.
 * Mounted per tapped slot (keyed by the host), so the entry is decided once from the pocket as it was tapped.
 */
export default function NativeSlotFlow({ pricing, ...detail }: ComponentProps<typeof SlotDetail> & { pricing: SelectorPricing }) {
  const { slot, picker, layout, onClose } = detail
  const [stage, setStage] = useState<Stage>(() => picker && !layout && !slot.item ? { kind: slot.pokemon ? "pick" : "search" } : { kind: "detail" })
  if (stage.kind === "pick" && slot.pokemon && !slot.item) {
    const pokemonId = slot.pokemon.id
    return <CardSelector pokemonId={pokemonId} pokemonName={slot.pokemon.name} onSelect={unusedLegacySelect} onClose={onClose}
      selectedWantedCardId={slot.wantedCards[0]?.card_id} {...pricing}
      native={{ onPick: (card, finish) => setStage({ kind: "chosen", card: speciesSelectorCard(card, pokemonId), finish }), onEditSlot: () => setStage({ kind: "edit" }) }} />
  }
  // A pocket filled meanwhile (another device, a partner) falls back to its detail, never to a selection for it.
  const flow: SlotPickerFlow | undefined = stage.kind === "detail" || slot.item ? undefined
    : { entry: stage.kind === "edit" ? "edit" : "assign", chosen: stage.kind === "chosen" ? stage : undefined, onBack: () => setStage({ kind: "pick" }) }
  return <SlotDetail {...detail} flow={flow} />
}
