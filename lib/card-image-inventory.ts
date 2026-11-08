/** Called by mirror writes/listings, never by API serialization. */
export async function recordMirroredCardImages(bucket:string,keys:readonly string[]) {
 if(!keys.length)return
 const {createAdminClient}=await import('./supabase/admin')
 const admin=createAdminClient()
 for(let n=0;n<keys.length;n+=500) {
  const {error}=await admin.from('card_image_inventory').upsert(keys.slice(n,n+500).map(object_key=>({bucket,object_key,observed_at:new Date().toISOString()})),{onConflict:'bucket,object_key'})
  if(error)throw new Error('Card image inventory update failed')
 }
}
