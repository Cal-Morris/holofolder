import { isSlotContractId } from "@/lib/domain/binder-slots"

/** Versioned compatibility identity, shared with legacy_binder_slot_id_v1 in migration 073. */
export function legacySlotId(collectionId: string, pokemonId: number): string {
  const id = `legacy-dex-v1/${collectionId}/${pokemonId}`
  if (!isSlotContractId(collectionId) || !isSlotContractId(id) || !Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > 1025) {
    throw new Error("Invalid legacy slot identity")
  }
  return id
}
