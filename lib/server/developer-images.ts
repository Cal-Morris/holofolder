import { AwsClient } from 'aws4fetch'
import { cacheLife, cacheTag } from 'next/cache'
import { parseTcgdexCardImageUrl, getCardImageBlobPathname } from '@/lib/card-image-blob'
import { parseSourceCardImageUrl } from '@/lib/card-image-sources'
import { createR2Deps, getR2Config, getR2BucketEndpoint } from '@/lib/card-image-r2'
export type DeveloperImage = {url:string|null;availability:'available'|'missing'|'unavailable'}
export async function resolveImageFromR2(source:unknown,head:(key:string)=>Promise<{url:string}|null>):Promise<DeveloperImage> {
 if(typeof source!=='string') return {url:null,availability:'missing'}
 const tcgdex=parseTcgdexCardImageUrl(source)
 const key=tcgdex?getCardImageBlobPathname(tcgdex):parseSourceCardImageUrl(source)?.pathname
 if(!key) return {url:null,availability:'missing'}
 try {const object=await head(key);return object?{url:object.url,availability:'available'}:{url:null,availability:'missing'}}
 catch {return {url:null,availability:'unavailable'}}
}
export async function resolveDeveloperImage(source:string|null):Promise<DeveloperImage> {
 if(!source)return {url:null,availability:'missing'}
 return resolvePresentDeveloperImage(source)
}
async function resolvePresentDeveloperImage(source:string):Promise<DeveloperImage> {
 'use cache: remote'
 cacheLife({stale:60,revalidate:60,expire:120});cacheTag('tcg-mirror')
 const config=getR2Config()
 if(!config) return {url:null,availability:'unavailable'}
 const deps=createR2Deps(config)
 return resolveImageFromR2(source,async(key)=>{
  const object=await deps.head(key)
  if(!object || config.publicBaseUrl) return object
  const signer=new AwsClient({accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey,service:'s3',region:'auto'})
  const url=new URL(`${getR2BucketEndpoint(config)}${key}`);url.searchParams.set('X-Amz-Expires','300')
  return {url:(await signer.sign(url,{aws:{signQuery:true}})).url}
 })
}
