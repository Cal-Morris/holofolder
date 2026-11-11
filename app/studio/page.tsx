import { createClient } from "@/lib/supabase/server"
import { getSessionUser } from "@/lib/supabase/session-user"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { readOwnerInventoryState } from "@/lib/server/inventory-read"
import { buildSlotDisplay, displaySlotImageUrl } from "@/lib/binder-display-model"
import { getDefaultBinderSettings } from "@/lib/settings"
import { isCardArtworkUrl, type StudioCard } from "@/lib/binder-design"
import BinderDesigner from "@/components/binder-designer/designer"
export const instant = false
export const metadata = { title: "Binder Studio · Holo Folder" }

/** The default binder's pockets from the native inventory read; null when the read fails. */
async function readStudioSlots(supabase: Awaited<ReturnType<typeof createClient>>) {
  try {
    const { snapshot, navigation, defaultCollectionId } = await readOwnerInventoryState(supabase)
    const binder = snapshot.binders.find(b => b.collectionId === defaultCollectionId) ?? snapshot.binders[0]
    if (!binder) return []
    const catalog = new Map(navigation.catalog.map(entry => [entry.card.id, entry.card]))
    return buildSlotDisplay(binder, snapshot, cardId => catalog.get(cardId))
  } catch {
    return null
  }
}

export default async function StudioPage() {
  const supabase = await createClient()
  const user = await getSessionUser(supabase)
  if (!user) return <BinderDesigner key="guest-demo" owner={null} cards={[]} placed={0} wanted={0} settings={getDefaultBinderSettings()} />
  const owner = await resolveCollectionOwnerUserId(supabase,user.id,{fallbackOnError:true})
  const [bootstrap, slots] = await Promise.all([loadBinderBootstrap(supabase,owner), readStudioSlots(supabase)])
  const cards: StudioCard[] = []
  const occupiedSlots: number[] = []
  let wanted = 0
  slots?.forEach((slot, index) => {
    wanted += slot.wantedCards.length
    if (!slot.item) return
    occupiedSlots.push(index)
    const image = displaySlotImageUrl(slot, "current") ?? ""
    if (slot.item.identity.kind === "card" && slot.card && isCardArtworkUrl(image)) cards.push({id:slot.item.identity.cardId,name:slot.card.name,image,slot:index})
  })
  return <BinderDesigner key={`${user.id}:${owner}`} owner={owner} legacyKey={`owner:${user.id}:${owner}`} cards={cards} placed={occupiedSlots.length} occupiedSlots={occupiedSlots} wanted={wanted} settings={bootstrap.settings} collectionError={slots === null} />
}
