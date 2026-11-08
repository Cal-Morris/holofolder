import {test} from 'node:test'
import assert from 'node:assert/strict'
import {decodePage, encodeCursor} from '@/lib/developer-api/pagination'

test('cursors bind to a query and page size is bounded',()=>{
 const params=new URLSearchParams('limit=100&q=ピカチュウ')
 const cursor=encodeCursor('synthetic-card-1000',params)
 assert.equal(decodePage(new URLSearchParams({...Object.fromEntries(params),cursor})).after,'synthetic-card-1000')
 assert.throws(()=>decodePage(new URLSearchParams({limit:'101'})))
 assert.throws(()=>decodePage(new URLSearchParams({cursor,q:'different',limit:'100'})))
 assert.throws(()=>decodePage(new URLSearchParams({cursor:'invalid'})))
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

test('mixed-case illustrator pagination uses the same comparison for ordering and advancing',async()=>{
 const {paginateEntries}=await import('../lib/developer-api/pagination')
 const names=['AKIRA EGAWA','aky CG Works','HYOGONOSUKE']
 const params=new URLSearchParams('limit=2')
 const first=paginateEntries(names,params,name=>name)
 assert.equal(first.data.length,2);assert.ok(first.nextCursor)
 params.set('cursor',first.nextCursor!)
 const second=paginateEntries(names,params,name=>name)
 assert.equal(second.data.length,1)
 assert.equal(new Set([...first.data,...second.data]).size,3)
 assert.equal(second.nextCursor,null)
})

test('returned R2 URLs keep stable object identity without persisting signed query credentials',async()=>{
 const {developerImageKey,normalizeStoredDeveloperImage}=await import('../lib/developer-api/image-identity')
 const base='https://synthetic-r2.test/'
 const returned=`${base}cards/en/base1/1/high.webp?X-Amz-Signature=synthetic&X-Amz-Expires=300`
 assert.equal(developerImageKey(returned,[base]),'cards/en/base1/1/high.webp')
 assert.equal(normalizeStoredDeveloperImage(returned,[base]),`${base}cards/en/base1/1/high.webp`)
 assert.equal(developerImageKey('https://evil.test/cards/en/base1/1/high.webp',[base]),null)
 assert.equal(developerImageKey(`${base}private/owner/file`,[base]),null)
})
test('appearance card artwork exposes an opaque stable reference and R2-only display URL',async()=>{
 const {serializeDeveloperAppearance,restoreDeveloperAppearance}=await import('../lib/server/developer-appearance')
 const {defaultBinderDesign}=await import('../lib/binder-design')
 const design=defaultBinderDesign();design.surfaces.cover.artwork='/app/api/card-image-proxy?url='+encodeURIComponent('https://assets.tcgdex.net/en/base/base1/1/high.webp')
 design.surfaces.back.artwork='upload:9ade73fb-d75e-4174-86a1-9e4769b85f30'
 const result=await serializeDeveloperAppearance({design,revision:1},async()=>({url:'https://synthetic-r2.test/cards/en/base1/1/high.webp',availability:'available'}))
 assert.ok(result.design)
 assert.equal(result.design.surfaces.cover.artwork,'tcgdex:en/base/base1/1/high.webp')
 assert.equal(result.design.surfaces.cover.artworkImage?.url,'https://synthetic-r2.test/cards/en/base1/1/high.webp')
 assert.equal(result.design.surfaces.back.artwork,design.surfaces.back.artwork)
 assert.equal(JSON.stringify(result).includes('card-image-proxy'),false)
 assert.equal(JSON.stringify(result).includes('assets.tcgdex.net'),false)
 const restored=restoreDeveloperAppearance(result.design)
 assert.equal(restored.surfaces.cover.artwork,design.surfaces.cover.artwork)
})

test('external identifiers follow the ingestion contract and include variant IDs',async()=>{
 const {readExternalIdentifiers}=await import('../lib/developer-api/catalog')
 assert.deepEqual(readExternalIdentifiers({tcgdex:{thirdParty:{tcgplayer:123,cardmarket:456},variantThirdParty:[{tcgplayer:789}]},pokemon_tcg:{cardId:'synthetic-1'},catalog:{productId:'987'}}),{tcgplayer:['123','789','987'],cardmarket:['456'],pokemontcg:['synthetic-1']})
})
test('set source reads traverse the PostgREST cap before grouping slots',async()=>{
 const {readSetCardPages}=await import('../lib/tcg-mirror')
 const synthetic=Array.from({length:1001},(_,id)=>({id}))
 const pages:number[]=[]
 const rows=await readSetCardPages(async(from,to)=>{pages.push(from);return {data:synthetic.slice(from,to+1),error:null}})
 assert.equal(rows.length,1001)
 assert.equal(new Set(rows.map(row=>row.id)).size,1001)
 assert.deepEqual(pages,[0,500,1000])
})

test('image provenance and available-language metadata survive serialization',async()=>{
 const {sanitizeDeveloperImages}=await import('../lib/server/developer-image-fields')
 const metadata={imageLanguages:['en','ja'],imageAvailability:'available'}
 assert.deepEqual(await sanitizeDeveloperImages(metadata,async()=>({url:null,availability:'missing'})),metadata)
})
