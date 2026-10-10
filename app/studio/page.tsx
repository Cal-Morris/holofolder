import { createClient } from "@/lib/supabase/server"
import { loadBinderBootstrap } from "@/lib/server/binder-bootstrap"
import { resolveCollectionOwnerUserId } from "@/lib/server/collection-owner"
import { getDefaultBinderSettings } from "@/lib/settings"
import { normalizeCollectionItem } from "@/lib/collection/normalize"
import { isCardArtworkUrl, type StudioCard } from "@/lib/binder-design"
import BinderDesigner from "@/components/binder-designer/designer"
export const instant = false
export const metadata = { title: "Binder Studio · BinderDex" }
export default async function StudioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return <BinderDesigner key="guest-demo" owner={null} cards={[]} placed={0} wanted={0} settings={getDefaultBinderSettings()} />
  const owner = await resolveCollectionOwnerUserId(supabase,user.id,{fallbackOnError:true})
  const bootstrap = await loadBinderBootstrap(supabase,owner)
  const collection = bootstrap.collection.map(normalizeCollectionItem)
  const cards: StudioCard[] = []
  for (const item of collection) {
    const image = item.card_image?.startsWith("/api/card-image-proxy?") ? item.card_image : `/api/card-image-proxy?url=${encodeURIComponent(item.card_image ?? "")}`
    if (item.card_id && item.card_name && isCardArtworkUrl(image) && item.status !== "wishlisted") cards.push({id:item.card_id,name:item.card_name,image,slot:item.pokemon_id-1})
  }
  return <BinderDesigner key={`${user.id}:${owner}`} owner={owner} legacyKey={`owner:${user.id}:${owner}`} cards={cards} placed={collection.filter(c=>c.status==="collected"||c.status==="finalized").length} occupiedSlots={collection.filter(c=>c.status==="collected"||c.status==="finalized").map(c=>c.pokemon_id-1)} wanted={collection.reduce((sum,c)=>sum+c.wanted_cards.length+(c.status==="wishlisted"&&!c.wanted_cards.length?1:0),0)} settings={bootstrap.settings} collectionError={Boolean(bootstrap.collectionError)} />
}
