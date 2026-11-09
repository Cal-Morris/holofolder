import { isSlotContractId } from "@/lib/domain/binder-slots"
import { fetchAllRows } from "@/lib/supabase/fetch-all-rows"

/** Versioned compatibility identity, shared with legacy_binder_slot_id_v1 in migration 073. */
export function legacySlotId(collectionId: string, pokemonId: number): string {
  const id = `legacy-dex-v1/${collectionId}/${pokemonId}`
  if (!isSlotContractId(collectionId) || !isSlotContractId(id) || !Number.isInteger(pokemonId) || pokemonId < 1 || pokemonId > 1025) {
    throw new Error("Invalid legacy slot identity")
  }
  return id
}

/** Retain this alongside queued guest intent until explicit account/owner confirmation.
 * This records source identity only; #363 owns reconciliation and #365 import acceptance. */
export function legacyWorkspaceMapping(input: { workspaceId: string; collectionId: string; rowIds: readonly string[] }) {
  if (!isSlotContractId(input.workspaceId) || !isSlotContractId(input.collectionId)
    || !input.rowIds.every(isSlotContractId) || new Set(input.rowIds).size !== input.rowIds.length) {
    throw new Error("Invalid legacy workspace mapping")
  }
  return { version: 1 as const, workspaceId: input.workspaceId, collectionId: input.collectionId, recipient: null, rowIds: [...input.rowIds] }
}

/** An absent schema/state is the only fallback. Never fall back after authorization or network errors. */
export function readStorageAuthority(row: unknown, error: { code?: string } | null): "legacy" | "slots" {
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return "legacy"
    throw new Error("Storage authority unavailable")
  }
  if (row === null) return "legacy"
  if (typeof row === "object" && row) {
    const state = row as { authority?: unknown; conversion_version?: unknown }
    if (state.authority === "legacy" && state.conversion_version === null) return "legacy"
    if (state.authority === "slots" && (state.conversion_version === 1 || state.conversion_version === null)) return "slots"
  }
  throw new Error("Unsupported storage authority")
}

/** Caller scopes by owner + collection and orders by position,id under a stable layout revision.
 * Reject partial data; #362 must retry the complete read if the revision changes between pages. */
export async function loadAllStoredSlots<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const result = await fetchAllRows(fetchPage)
  if (result.error) throw new Error("Stored slots unavailable", { cause: result.error })
  return result.data
}
