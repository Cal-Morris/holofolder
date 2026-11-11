import { navigationIndex, type CollectionNavigationRead, type CollectionNavigationScope } from "@/lib/collection-navigation"
import { slabPresentation } from "@/lib/slabs/presentation"

/** Uses the host's exact session/actor/owner fence. Cached subsets are display evidence only.
 * Slabs are graded cards: a card with no recorded grade is never shown as a slab, and no grade is inferred. */
export function slabCollectionCopies(scope: CollectionNavigationScope, read: CollectionNavigationRead, collectionId: string) {
  const index = navigationIndex(scope, read)
  if (index.kind === "unavailable" || read.evidence.kind === "unavailable" || !index.collections.some(c => c.id === collectionId)) return []
  const items = new Map(read.evidence.snapshot.items.map(item => [item.id, item]))
  return index.rows.filter(row => row.location.kind === "assigned" && row.location.intent.collectionId === collectionId).flatMap(row => {
    const item = items.get(row.itemId)
    return item?.grading ? [{ itemId: row.itemId, slab: slabPresentation(row, item.grading) }] : []
  })
}
