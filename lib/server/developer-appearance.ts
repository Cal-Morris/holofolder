import {DESIGN_SURFACES,type BinderDesign,type DesignSurface,type SurfaceDesign} from '@/lib/binder-design'
import {developerArtworkReference,developerImageSource} from '@/lib/developer-api/image-identity'
import {createDeveloperImageResolver,type DeveloperImage} from './developer-images'
import {DeveloperAccessError} from '@/lib/developer-api/permissions'
type DeveloperDesign=Omit<BinderDesign,'surfaces'>&{surfaces:Record<DesignSurface,SurfaceDesign&{artworkImage?:DeveloperImage}>}
export async function serializeDeveloperAppearance<T extends {design:BinderDesign|null}>(value:T,resolve?: (source:string|null)=>Promise<DeveloperImage>) {
 const design=structuredClone(value.design) as DeveloperDesign|null
 if(!design)return {...value,design:null}
 resolve??=await createDeveloperImageResolver(design.surfaces)
 for(const surface of DESIGN_SURFACES) {
  const entry=design.surfaces[surface]
  if(!entry.artwork||entry.artwork.startsWith('upload:'))continue
  const source=developerImageSource(entry.artwork),reference=developerArtworkReference(source)
  entry.artwork=reference
  entry.artworkImage=reference?await resolve(source):{url:null,availability:'missing'}
 }
 return {...value,design}
}

export function restoreDeveloperAppearance(value:unknown):BinderDesign {
 const design=structuredClone(value) as BinderDesign
 if(!design||typeof design!=='object'||!design.surfaces||typeof design.surfaces!=='object')throw new DeveloperAccessError('invalid_appearance','Invalid binder appearance.',400)
 for(const surface of DESIGN_SURFACES) {
  const entry=design.surfaces[surface]
  if(entry?.artwork?.startsWith('tcgdex:')) {
   const source=developerImageSource(entry.artwork)
   if(!developerArtworkReference(source))throw new DeveloperAccessError('invalid_artwork','Invalid card artwork reference.',400)
   entry.artwork=`/app/api/card-image-proxy?url=${encodeURIComponent(source)}`
  }
 }
 return design
}
