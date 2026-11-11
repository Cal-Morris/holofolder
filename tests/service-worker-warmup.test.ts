import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"

test("page warm-ups share one bounded queue and never download the same pending URL twice", async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const requests: string[] = []
  let active = 0
  let peak = 0
  const cache = { match: async () => undefined, put: async () => undefined }
  const context = createContext({
    URL, Request,
    self: { location: { origin: "https://holofolder.com" }, addEventListener: () => {} },
    caches: { open: async () => cache },
    fetch: async (request: Request) => {
      requests.push(request.url)
      peak = Math.max(peak, ++active)
      await pending
      active--
      return new Response("synthetic card image")
    },
  })
  runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context)
  const urls = Array.from({ length: 12 }, (_, index) => `/app/api/card-image-proxy?url=synthetic-${index}`)
  context.urls = urls
  const runs = [1, 2, 3].map(() => runInContext("warmCacheUrls(urls)", context) as Promise<void>)
  await new Promise(resolve => setImmediate(resolve))
  release()
  await Promise.all(runs)
  assert.ok(peak <= 4, `warm-up concurrency was ${peak}, expected at most 4 across page turns`)
  assert.equal(requests.length, urls.length, "overlapping page warm-ups reuse pending downloads")
})

test("newly visible URLs go ahead of older queued work and a failed warm-up can retry", async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const requests: string[] = []
  let fail = true
  const context = createContext({
    URL, Request,
    self: { location: { origin: "https://holofolder.com" }, addEventListener: () => {} },
    caches: { open: async () => ({ match: async () => undefined, put: async () => undefined }) },
    fetch: async (request: Request) => {
      requests.push(new URL(request.url).searchParams.get("url")!)
      await pending
      if (fail && request.url.includes("latest")) throw new Error("synthetic network failure")
      return new Response("synthetic card image")
    },
  })
  runInContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), context)
  context.older = Array.from({ length: 12 }, (_, index) => `/app/api/card-image-proxy?url=older-${index}`)
  const first = runInContext("warmCacheUrls(older)", context) as Promise<void>
  await new Promise(resolve => setImmediate(resolve))
  const latest = runInContext('warmCacheUrls(["/app/api/card-image-proxy?url=latest"])', context) as Promise<void>
  assert.equal(requests.length, 4, "a new page must not start a separate worker pool")
  release()
  await Promise.all([first, latest])
  assert.equal(requests[4], "latest", "the latest page is next once a download slot is free")
  assert.equal(requests.length, 13, "older queued images still finish")
  fail = false
  await runInContext('warmCacheUrls(["/app/api/card-image-proxy?url=latest"])', context)
  assert.equal(requests.at(-1), "latest")
  assert.equal(requests.length, 14)
})

test('public asset requests reuse existing proxy/show caches when offline',async()=>{
 const legacy='https://holofolder.com/app/api/card-image-proxy?url='+encodeURIComponent('https://assets.tcgdex.net/en/base/base1/1/high.webp')+'&w=160'
 const stored=new Response('synthetic legacy cached card')
 const context=createContext({URL,Request,self:{location:{origin:'https://holofolder.com'},addEventListener:()=>{}},
  caches:{open:async()=>({keys:async()=>[new Request(legacy)],match:async(request:Request|string)=>typeof request==='object'&&request.url===legacy?stored.clone():undefined,put:async()=>{}})},
  fetch:async()=>{throw new Error('synthetic offline')},
 })
 runInContext(readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),context)
 context.request=new Request('https://assets.holofolder.com/pokemon/tcg/cards/en/base1/1/low.webp')
 const response=await runInContext('cacheFirst(request, IMAGE_CACHE)',context) as Response
 assert.equal(await response.text(),'synthetic legacy cached card')
 // An old-layout asset URL finds the same cached image.
 context.request=new Request('https://assets.holofolder.com/cards/en/base1/1/low.webp')
 assert.equal(await (await runInContext('cacheFirst(request, IMAGE_CACHE)',context) as Response).text(),'synthetic legacy cached card')
 context.request=new Request('https://private.synthetic.test/cards/en/base1/1/low.webp')
 await assert.rejects(()=>runInContext('cacheFirst(request, IMAGE_CACHE)',context),/synthetic offline/)
})
