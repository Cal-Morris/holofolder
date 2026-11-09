import type { TCGSetSlotCard } from "@/lib/tcg-set-slots"
// Deliberately synthetic catalog fixtures. No real printings, availability or prices.
export const syntheticPresetSet = { id: "synthetic-set", name: "Synthetic International Anniversary Special Collection", officialCardCount: 3 }
export const syntheticPresetCards: TCGSetSlotCard[] = [
  ["10", "Synthetic basic Energy"], ["2", "Synthetic supporter"], ["1", "Synthetic repeated Pokémon"],
  ["4", "Synthetic repeated Pokémon"], ["TG2", "Synthetic item subset"], ["104", "Synthetic secret Trainer"],
].map(([localId, name]) => ({ id: `synthetic-set-${localId}`, localId, name, set: syntheticPresetSet,
  language: "en", languageConfirmed: true, variants: { normal: true, reverse: localId === "1", holo: false }, inferredFinish: "normal" }))
export const syntheticPresetPromo: TCGSetSlotCard = { ...syntheticPresetCards[0], id: "synthetic-promo-1", localId: "P1", name: "Synthetic selected promo", set: { id: "synthetic-promos", name: "Synthetic promos" } }
