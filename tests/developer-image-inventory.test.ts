import {test} from 'node:test'
import assert from 'node:assert/strict'
import {collectDeveloperImageKeys,resolveRecordedDeveloperImage} from '@/lib/server/developer-images'

const base='https://assets.synthetic.test/'
const source='https://assets.tcgdex.net/en/base/base1/1/high.webp'
const key='cards/en/base1/1/high.webp'

test('inventory lookup deduplicates nested images and excludes arbitrary URLs and private artwork',()=>{
 assert.deepEqual(collectDeveloperImageKeys([source,{image:source,images:{large:`${base}${key}?signature=synthetic`}},'https://evil.test/card.png',`${base}private/owner/artwork`],[base]),[key])
})
test('recorded images produce stable public URLs without contacting storage',()=>{
 assert.deepEqual(resolveRecordedDeveloperImage(source,new Set([key]),base,[base]),{url:base+key,availability:'available'})
 assert.deepEqual(resolveRecordedDeveloperImage(source,new Set(),base,[base]),{url:null,availability:'missing'})
 assert.deepEqual(resolveRecordedDeveloperImage('https://evil.test/card.png',new Set([key]),base,[base]),{url:null,availability:'missing'})
 assert.deepEqual(resolveRecordedDeveloperImage(`${base}${key}?X-Amz-Signature=synthetic`,new Set([key]),base,[base]),{url:base+key,availability:'available'})
})

test('R2 writes and listings record confirmed objects for subsequent API reads',async()=>{
 const {createR2Deps}=await import('../lib/card-image-r2')
 const seen:string[][]=[]
 const deps=createR2Deps({accountId:'a'.repeat(32),bucket:'synthetic-cards',accessKeyId:'synthetic-key',secretAccessKey:'synthetic-secret',publicBaseUrl:base},{
  fetch:async (_input,init)=>init?.method==='PUT'?new Response(null,{status:200}):new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>cards/en/base1/1/high.webp</Key></Contents></ListBucketResult>'),
  onObjects:async keys=>{seen.push(keys)},
 })
 await deps.put(key,new ArrayBuffer(1),'image/webp')
 assert.deepEqual(await deps.list('cards/'),[key])
 assert.deepEqual(seen,[[key],[key]])
})
