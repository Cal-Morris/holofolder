import { buildNamedBinderSharePath } from "@/lib/public-binder-identity"
import { normalizeCollectionItems } from "@/lib/collection/normalize"
import type { CollectedPokemon } from "@/lib/domain/cards"
import type { InventoryBrowseEvidence } from "@/lib/domain/inventory-browse"

/** Public bootstrap only contains card fields, never DB extras or partner identities. */
export function publicCollectionItems(rows: Partial<CollectedPokemon>[]) {
  return normalizeCollectionItems(rows).map(item => ({
    ...item,
    wanted_cards: (item.wanted_cards ?? []).map(({ wanted_by: _wantedBy, ...card }) => card),
  }))
}

export interface BinderShareRecord {
  owner_user_id: string
  binder_id?: string | null
  token: string
  show_prices?: boolean
  is_enabled: boolean
}

export function buildBinderSharePath(token: string) {
  return `/app/share/${token}`
}

export function buildBinderShareUrl(origin: string, tokenOrPath: string) {
  const named = /^\/@([^/]+)\/([^/]+)$/.exec(tokenOrPath)
  if (named) {
    const path = buildNamedBinderSharePath(named[1], named[2])
    const hostname = new URL(origin).hostname
    return ["holofolder.com", "app.holofolder.com", "binder.cal.gg"].includes(hostname)
      ? new URL(path, "https://holofolder.com").toString()
      : new URL(`/app/u/${named[1]}/${named[2]}`, origin).toString()
  }
  const token = tokenOrPath.replace(/^\/(?:app\/)?share\//, "")
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) throw new Error("Invalid share link")
  return new URL(buildBinderSharePath(token), origin).toString()
}

export interface NativeShareSelection {
  accountUserId: string
  ownerUserId: string
  collectionId: string
  evidence: InventoryBrowseEvidence
}

/**
 * The binder whose public link a signed-in owner or partner may manage, or null when they may not.
 * This is separate from legacy write suppression: native surfaces are read-only for legacy collection
 * writes but still manage shares. Native needs the selected collection of a fresh complete read for this
 * actor and owner (`native: null` when no collection is selected); it never falls back to a default binder.
 */
export function shareManagementTarget({ userId, ownerUserId, publicView, legacyBinderId, legacyWritable, native }: {
  userId: string | null
  ownerUserId: string | null
  /** A public share or other legacy read-only view: never owner controls. */
  publicView: boolean
  legacyBinderId: string | null
  legacyWritable: boolean
  /** Omitted outside native storage. */
  native?: NativeShareSelection | null
}): { binderId: string | null; name?: string } | null {
  if (!userId || publicView) return null
  if (native === undefined) return legacyWritable ? { binderId: legacyBinderId } : null
  if (!native || !ownerUserId || native.evidence.kind !== "complete" || native.accountUserId !== userId
    || native.ownerUserId !== ownerUserId || native.evidence.snapshot.ownerUserId !== ownerUserId) return null
  const collection = native.evidence.snapshot.collections.find(c => c.id === native.collectionId && c.ownerUserId === ownerUserId)
  return collection ? { binderId: collection.id, name: collection.name } : null
}
