// One-time rollout/backfill and reconciliation after manual bucket deletions.
// LISTs the public cards prefix, never downloads images. At most 150 Class A LISTs.
import {createR2Deps,getR2Config} from '../lib/card-image-r2'
import {recordMirroredCardImages} from '../lib/card-image-inventory'
import {createAdminClient} from '../lib/supabase/admin'
import {loadProjectEnvFiles} from '../lib/load-project-env'
import {CARD_IMAGE_BLOB_PREFIX} from '../lib/tcgdex-card-image'

async function main() {
await loadProjectEnvFiles()
const config=getR2Config()
if(!config||config.bucket===process.env.R2_ARTWORK_BUCKET)throw new Error('Configure the public card image bucket')
const started=new Date().toISOString()
let pages=0
const deps=createR2Deps(config,{fetch:async (...args)=>{
 if(++pages>150)throw new Error('Inventory LIST budget exceeded')
 return fetch(...args)
}})
const keys=await deps.list(`${CARD_IMAGE_BLOB_PREFIX}/`)
await recordMirroredCardImages(config.bucket,keys)
// Only prune after a complete successful listing; preserve uploads recorded during it.
const {error}=await createAdminClient().from('card_image_inventory').delete().eq('bucket',config.bucket).lt('observed_at',started)
if(error)throw new Error('Inventory reconciliation failed')
console.log(JSON.stringify({objects:keys.length,listRequests:pages}))

}
main().catch(()=>{console.error("Card image inventory sync failed");process.exitCode=1})
