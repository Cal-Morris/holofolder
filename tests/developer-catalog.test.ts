import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decodePage, encodeCursor} from '@/lib/developer-api/pagination'
import {resolveImageFromR2} from '@/lib/server/developer-images'

test('cursors bind to a query and page size is bounded',()=>{
 const params=new URLSearchParams('limit=100&q=ピカチュウ')
 const cursor=encodeCursor('synthetic-card-1000',params)
 assert.equal(decodePage(new URLSearchParams({...Object.fromEntries(params),cursor})).after,'synthetic-card-1000')
 assert.throws(()=>decodePage(new URLSearchParams({limit:'101'})))
 assert.throws(()=>decodePage(new URLSearchParams({cursor,q:'different',limit:'100'})))
 assert.throws(()=>decodePage(new URLSearchParams({cursor:'invalid'})))
})
test('R2 image resolver never fetches or returns an upstream source',async()=>{
 const seen:string[]=[]
 const resolve=async(key:string)=>{seen.push(key);return {url:`https://synthetic-r2.test/${key}`}}
 const hit=await resolveImageFromR2('https://assets.tcgdex.net/en/base/base1/1/high.webp',resolve)
 assert.equal(hit.url,'https://synthetic-r2.test/cards/en/base1/1/high.webp')
 assert.deepEqual(await resolveImageFromR2('https://malicious.test/image.png',resolve),{url:null,availability:'missing'})
 assert.deepEqual(await resolveImageFromR2('https://assets.tcgdex.net/en/base/base1/1/high.webp',async()=>null),{url:null,availability:'missing'})
 assert.deepEqual(await resolveImageFromR2('https://assets.tcgdex.net/en/base/base1/1/high.webp',async()=>{throw new Error('outage')}),{url:null,availability:'unavailable'})
 assert.deepEqual(seen,['cards/en/base1/1/high.webp'])
})

test('nested provider image shapes cannot leak upstream URLs',async()=>{
 const {sanitizeDeveloperImages}=await import('../lib/server/developer-image-fields')
 const output=await sanitizeDeveloperImages({images:{small:'https://upstream.test/a.png',large:'https://upstream.test/b.png'},nested:{image_url:'https://upstream.test/c.png'},thumbnails:['https://upstream.test/d.png'],url:'https://provider.test/listing'},async()=>({url:null,availability:'missing'}))
 assert.deepEqual(output,{images:{small:null,smallAvailability:'missing',large:null,largeAvailability:'missing'},nested:{image_url:null,image_urlAvailability:'missing'},thumbnails:[null],url:'https://provider.test/listing'})
})

test('missing image fields need no storage configuration or cache lookup',async()=>{
 const {resolveDeveloperImage}=await import('../lib/server/developer-images')
 assert.deepEqual(await resolveDeveloperImage(null),{url:null,availability:'missing'})
})
