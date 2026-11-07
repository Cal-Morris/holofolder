// Holo Folder card logo update; keep cache and message identifiers compatible with existing installs.
const CACHE_VERSION = "binderdex-v5"
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const DATA_CACHE = "binderdex-v4-data"
// Images keep their v3 name so the cards people already cached survive this upgrade.
const IMAGE_CACHE = "binderdex-v3-images"
// Thumbnails saved by "Prepare for card show". They live apart from IMAGE_CACHE so everyday browsing
// can't evict them: that cache drops its oldest entries past MAX_IMAGE_CACHE_ENTRIES, and prepared
// thumbnails are often the oldest (or were already cached long before, so a prep hit didn't refresh them).
const SHOW_IMAGE_CACHE = "binderdex-v1-show-images"
// Card scanning's text reader (tesseract.js): its worker script, engine and English data come from
// jsDelivr on first use. Keeping them here lets Scan read cards offline at a show once they were
// downloaded online (by opening Scan or by "Prepare for card show"). The URLs are versioned, so cache-first.
const OCR_CACHE = "binderdex-v1-ocr"
const KEEP_CACHES = [APP_SHELL_CACHE, DATA_CACHE, IMAGE_CACHE, SHOW_IMAGE_CACHE, OCR_CACHE]
// Requests from the card show prep carry this header (see lib/card-show-prep.ts).
const SAVE_FOR_SHOW_HEADER = "x-binderdex-save"
const SAVE_FOR_SHOW_VALUE = "show"
const WARM_CACHE_MESSAGE_TYPE = "BINDERDEX_WARM_CACHE"
const MAX_WARM_CACHE_URLS = 500
const WARM_CACHE_CONCURRENCY = 4
// Oldest entries are evicted beyond this (card images are ~20-200 KB each).
const MAX_IMAGE_CACHE_ENTRIES = 1500

// Static, user-independent page that boots the binder from local data (app/app-shell).
// Served for any navigation the network can't answer, instead of a per-user cached "/".
const APP_SHELL_URL = "/app/app-shell"
// On weak Wi-Fi, stop waiting for the server after this long and open the offline shell.
// Only for the app's own entry pages: auth callbacks, share links etc. always wait for the server.
const NAVIGATION_TIMEOUT_MS = 6000
const LEGACY_BINDER_ORIGIN = self.location.origin === "https://binder.cal.gg"
const APP_ENTRY_PATHS = ["/app", "/app/", APP_SHELL_URL, ...(LEGACY_BINDER_ORIGIN ? ["/", "/home"] : [])]
const APP_SHELL_REFRESH_INTERVAL_MS = 10 * 60 * 1000
let lastAppShellRefreshAt = 0

const APP_SHELL_ASSETS = [
  "/app/favicon.ico",
  "/app/manifest.webmanifest",
  "/app/apple-icon.png",
  "/app/apple-touch-icon-holo-card.png",
  "/app/pwa-holo-card-192.png",
  "/app/pwa-holo-card-512.png",
  "/app/holo-card-mark.png",
  "/app/icon.svg",
  "/app/icon-light-32x32.png",
  "/app/icon-dark-32x32.png",
  "/app/pwa-192x192.png",
  "/app/pwa-512x512.png",
]

function isOcrAssetUrl(url) {
  return (
    url.origin === "https://cdn.jsdelivr.net" &&
    /^\/npm\/(?:tesseract\.js@|tesseract\.js-core@|@tesseract\.js-data\/)/.test(url.pathname)
  )
}

function isCacheableResponse(response) {
  return Boolean(response) && (response.ok || response.type === "opaque")
}

function isImagePath(pathname) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(pathname)
}

function getCacheNameForUrl(url) {
  if (
    url.pathname.startsWith("/app/api/card-image-proxy") ||
    isImagePath(url.pathname)
  ) {
    return IMAGE_CACHE
  }

  if (
    url.pathname.startsWith("/app/api/tcgdex-cache") ||
    url.pathname.startsWith("/app/api/tcg-set-slots") ||
    url.pathname.startsWith("/app/api/tcg-card-search") ||
    url.pathname.startsWith("/app/api/tcg-illustrators")
  ) {
    return DATA_CACHE
  }

  return APP_SHELL_CACHE
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  // Cache keys come back in insertion order, so the oldest entries go first.
  const excess = keys.length - maxEntries
  for (let index = 0; index < excess; index += 1) {
    await cache.delete(keys[index])
  }
}

let imagePutsSinceTrim = 0

function isSaveForShowRequest(request) {
  return request.headers.get(SAVE_FOR_SHOW_HEADER) === SAVE_FOR_SHOW_VALUE
}

// Explicit downloads survive ordinary browsing, with no application eviction cap.
// Browser storage still limits them; preparation verifies storage writes separately.
async function saveForShow(url, response) {
  const cache = await caches.open(SHOW_IMAGE_CACHE)
  await cache.put(url, response)
}

async function putInCache(cache, cacheName, request, response) {
  await cache.put(request, response)
  if (cacheName !== IMAGE_CACHE) return
  // Listing a big cache isn't free, so trim every 25 new images rather than on every write.
  imagePutsSinceTrim += 1
  if (imagePutsSinceTrim >= 25) {
    imagePutsSinceTrim = 0
    await trimCache(IMAGE_CACHE, MAX_IMAGE_CACHE_ENTRIES)
  }
}

function legacyApiRequest(request) {
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/app/api/")) return request
  url.pathname = url.pathname.slice(4)
  return url.href
}

async function cacheFirst(request, cacheName, event) {
  const cache = await caches.open(cacheName)
  const keepForShow = cacheName === IMAGE_CACHE && isSaveForShowRequest(request)
  const cached = (await cache.match(request)) ?? (await cache.match(legacyApiRequest(request))) ?? (cacheName === IMAGE_CACHE ? await caches.open(SHOW_IMAGE_CACHE).then(async (show) => (await show.match(request.url)) ?? show.match(legacyApiRequest(request))) : undefined)
  if (cached) {
    if (keepForShow) {
      const write = saveForShow(request.url, cached.clone()).catch(() => undefined)
      if (event) event.waitUntil(write)
    }
    return cached
  }

  const response = await fetch(request)
  if (isCacheableResponse(response)) {
    const writes = [putInCache(cache, cacheName, request, response.clone())]
    if (keepForShow) writes.push(saveForShow(request.url, response.clone()))
    const write = Promise.all(writes).catch(() => undefined)
    if (event) event.waitUntil(write)
  }
  return response
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)

  const networkFetch = fetch(request)
    .then((response) => {
      if (isCacheableResponse(response)) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => null)

  if (cached) {
    return cached
  }

  const response = await networkFetch
  if (response) {
    return response
  }

  throw new Error("No cached response available.")
}

// Card data: fresh from the network when it answers, otherwise the cached copy. When we already have a
// copy, a slow network (card-show Wi-Fi) only gets DATA_NETWORK_TIMEOUT_MS before we answer from cache;
// the request keeps going in the background and refreshes the cache.
const DATA_NETWORK_TIMEOUT_MS = 5000

async function networkFirst(request, cacheName, event) {
  const cache = await caches.open(cacheName)
  const cached = (await cache.match(request)) ?? (await cache.match(legacyApiRequest(request)))

  const network = fetch(request).then((response) => {
    if (isCacheableResponse(response)) {
      const write = cache.put(request, response.clone()).catch(() => undefined)
      if (event) event.waitUntil(write)
    }
    return response
  })

  if (!cached) {
    return network
  }

  network.catch(() => undefined)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(cached), DATA_NETWORK_TIMEOUT_MS)
    network.then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      () => {
        clearTimeout(timer)
        resolve(cached)
      },
    )
  })
}

function getAppShellAssetUrls(html) {
  const urls = new Set()
  // Scripts, stylesheets and preloads from the shell's <script>/<link> tags. noModule polyfills are only
  // for browsers without service workers, so they're skipped.
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    if (/\bnomodule\b/i.test(tag)) continue
    const match = tag.match(/\b(?:src|href)="(\/app\/_next\/static\/[^"?]+\.(?:js|css|woff2)(?:\?[^"]*)?)"/)
    if (match) urls.add(match[1].replace(/&amp;/g, "&"))
  }
  return [...urls]
}

// Fonts are referenced from the CSS (relative URLs), not the HTML. Only the subsets Next marks as
// preloaded ("-s.p.", Latin) are precached; the rest fall back to system fonts offline.
function getStylesheetFontUrls(css, cssUrl) {
  const urls = new Set()
  for (const [, rawUrl] of css.matchAll(/url\(\s*["']?([^"')]+\.woff2)["']?\s*\)/g)) {
    const url = new URL(rawUrl, new URL(cssUrl, self.location.origin))
    if (url.origin === self.location.origin && /-s\.p\./.test(url.pathname)) urls.add(url.pathname)
  }
  return [...urls]
}

// The binder lazy-loads its card detail, card lists, List/Sets views and settings (next/dynamic). Those
// chunks aren't in the shell HTML, only named inside the shell's own scripts ("static/chunks/x.js", or
// "static/immutable/chunks/x.js" on Vercel), so
// without this they'd be missing offline and opening a card would fail. Follow those references a few
// levels deep and cache what they name. Best effort: a chunk that fails to download doesn't block the shell.
const MAX_LAZY_CHUNKS = 150

function getReferencedChunkPaths(script, search) {
  const paths = new Set()
  for (const [, chunkPath] of script.matchAll(/["'](?:\/app\/_next\/)?(static\/(?:immutable\/)?chunks\/[\w.-]+\.(?:js|css))["']/g)) {
    paths.add(`/app/_next/${chunkPath}${search}`)
  }
  return [...paths]
}

async function precacheLazyChunks(cache, scriptUrls) {
  // Vercel skew protection adds ?dpl=… to every asset URL; lazy chunks are requested with the same query.
  const search = scriptUrls.map((url) => new URL(url, self.location.origin).search).find(Boolean) ?? ""
  const seen = new Set(scriptUrls)
  let level = scriptUrls
  for (let depth = 0; depth < 4 && level.length > 0 && seen.size < MAX_LAZY_CHUNKS + scriptUrls.length; depth += 1) {
    const next = []
    for (const scriptUrl of level) {
      const cached = await cache.match(scriptUrl)
      if (!cached) continue
      for (const chunkUrl of getReferencedChunkPaths(await cached.text(), search)) {
        if (seen.has(chunkUrl) || seen.size >= MAX_LAZY_CHUNKS + scriptUrls.length) continue
        seen.add(chunkUrl)
        next.push(chunkUrl)
      }
    }
    await runWithConcurrency(next, 4, async (chunkUrl) => {
      if (await cache.match(chunkUrl)) return
      const response = await fetch(chunkUrl, { credentials: "same-origin" })
      if (isCacheableResponse(response)) await cache.put(chunkUrl, response)
    })
    level = next.filter((chunkUrl) => /\.js(?:\?|$)/.test(chunkUrl))
  }
}

// Fetch the shell page plus the JS/CSS/fonts it references; only swap it in once every asset is cached,
// so the cached shell never points at chunks we don't have.
async function precacheAppShell() {
  const response = await fetch(new Request(APP_SHELL_URL, { cache: "reload", credentials: "same-origin" }))
  if (!response.ok || response.redirected) {
    throw new Error(`App shell request failed: ${response.status}`)
  }

  const html = await response.clone().text()
  const cache = await caches.open(APP_SHELL_CACHE)
  const assetUrls = getAppShellAssetUrls(html)
  const missing = []
  for (const assetUrl of assetUrls) {
    if (!(await cache.match(assetUrl))) missing.push(assetUrl)
  }
  await cache.addAll(missing)

  const fontUrls = []
  for (const cssUrl of assetUrls.filter((assetUrl) => /\.css(?:\?|$)/.test(assetUrl))) {
    const css = await cache.match(cssUrl).then((cached) => (cached ? cached.text() : ""))
    for (const fontUrl of getStylesheetFontUrls(css, cssUrl)) {
      if (!(await cache.match(fontUrl))) fontUrls.push(fontUrl)
    }
  }
  await cache.addAll([...new Set(fontUrls)])
  await precacheLazyChunks(cache, assetUrls.filter((assetUrl) => /\.js(?:\?|$)/.test(assetUrl))).catch(() => undefined)
  await cache.put(APP_SHELL_URL, response)
  lastAppShellRefreshAt = Date.now()
}

// After a deploy the shell HTML points at new chunks; re-fetch it now and then while online.
function refreshAppShellSoon() {
  if (Date.now() - lastAppShellRefreshAt < APP_SHELL_REFRESH_INTERVAL_MS) {
    return Promise.resolve()
  }
  lastAppShellRefreshAt = Date.now()
  return precacheAppShell().catch(() => {
    lastAppShellRefreshAt = 0
  })
}

async function getOfflineAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE)
  return cache.match(APP_SHELL_URL)
}

function fetchWithTimeout(request, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Navigation timed out")), timeoutMs)
    fetch(request).then(
      (response) => {
        clearTimeout(timer)
        resolve(response)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

// Pages are never cached per user. Online: the network, as before. Offline, or the server too slow
// to answer: the static app shell, which renders the binder from this device's saved data.
async function handleNavigation(event) {
  const { request } = event
  const url = new URL(request.url)
  const isShellRequest = url.pathname === APP_SHELL_URL
  // Auth routes set cookies and redirect, and share links show someone else's binder: never answer
  // them with the shell (which shows your own binder).
  const canUseShell = url.origin === self.location.origin && (/^\/app(?:\/|$)/.test(url.pathname) || (LEGACY_BINDER_ORIGIN && APP_ENTRY_PATHS.includes(url.pathname))) && !/^\/(?:app\/)?(?:auth|share)(?:\/|$)/.test(url.pathname)
  const useTimeout = canUseShell && APP_ENTRY_PATHS.includes(url.pathname) && Boolean(await getOfflineAppShell())

  try {
    const response = useTimeout ? await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS) : await fetch(request)
    if (!isShellRequest) {
      event.waitUntil(refreshAppShellSoon())
    }
    return response
  } catch (error) {
    const shell = canUseShell ? await getOfflineAppShell() : null
    if (shell) {
      return shell
    }
    throw error
  }
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]
      nextIndex += 1
      await worker(item).catch(() => undefined)
    }
  })
  await Promise.all(runners)
}

async function warmCacheUrl(rawUrl) {
  const url = new URL(rawUrl, self.location.origin)
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return
  }

  // Pages aren't cached per user any more; warming "/" means "make sure the offline shell is ready".
  if (url.origin === self.location.origin && (APP_ENTRY_PATHS.includes(url.pathname))) {
    if (!(await getOfflineAppShell())) {
      await precacheAppShell()
    }
    return
  }

  const request = new Request(url.toString(), {
    credentials: url.origin === self.location.origin ? "same-origin" : "omit",
  })
  const cacheName = getCacheNameForUrl(url)
  if (cacheName === APP_SHELL_CACHE) return
  const cache = await caches.open(cacheName)

  if (await cache.match(request)) {
    return
  }

  const response = await fetch(request)
  if (isCacheableResponse(response)) {
    await putInCache(cache, cacheName, request, response.clone())
  }
}

async function warmCacheUrls(rawUrls) {
  if (!Array.isArray(rawUrls)) {
    return
  }

  const urls = [...new Set(rawUrls.filter((url) => typeof url === "string" && url.length > 0))]
    .slice(0, MAX_WARM_CACHE_URLS)

  await runWithConcurrency(urls, WARM_CACHE_CONCURRENCY, warmCacheUrl)
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(APP_SHELL_CACHE)
      .then((cache) =>
        cache.addAll(
          APP_SHELL_ASSETS.map((asset) => new Request(asset, { cache: "reload" })),
        ),
      )
      .catch(() => undefined)
      .then(() => precacheAppShell())
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("binderdex-") && !KEEP_CACHES.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting()
  }

  if (event.data?.type === "BINDERDEX_REFRESH_APP_SHELL") {
    event.waitUntil(precacheAppShell().catch(() => undefined))
  }

  if (event.data?.type === WARM_CACHE_MESSAGE_TYPE) {
    event.waitUntil(warmCacheUrls(event.data.urls))
  }
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (request.mode === "navigate") {
    if (url.origin !== self.location.origin || (!/^\/app(?:\/|$)/.test(url.pathname) && !(LEGACY_BINDER_ORIGIN && APP_ENTRY_PATHS.includes(url.pathname)))) return
    event.respondWith(handleNavigation(event))
    return
  }

  if (
    request.destination === "image" ||
    url.pathname.startsWith("/app/api/card-image-proxy")
  ) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, event))
    return
  }

  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/app/_next/static/") ||
      url.pathname.startsWith("/app/_next/image") ||
      APP_SHELL_ASSETS.includes(url.pathname)
    )
  ) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE))
    return
  }

  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/app/api/tcgdex-cache") ||
      url.pathname.startsWith("/app/api/tcg-set-slots") ||
      url.pathname.startsWith("/app/api/tcg-card-search") ||
      url.pathname.startsWith("/app/api/tcg-illustrators")
    )
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE, event))
    return
  }

  if (isOcrAssetUrl(url)) {
    event.respondWith(cacheFirst(request, OCR_CACHE, event))
    return
  }

  if (url.origin !== self.location.origin && request.destination === "image") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, event))
  }
})

// The account binding contains no subscription keys or collection data. It is cleared before sign-out.
function notificationAccount() {
  return new Promise(resolve => {
    const request = indexedDB.open('binderdex-offline', 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records')
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('records', 'readonly')
      const read = transaction.objectStore('records').get('push:account')
      read.onsuccess = () => resolve(read.result?.userId ?? null)
      read.onerror = () => resolve(null)
      transaction.oncomplete = () => db.close()
    }
  })
}

function notificationDestination(value) {
  try {
    const url = new URL(value, self.location.origin)
    if (url.origin !== self.location.origin || (url.pathname !== '/app' && url.pathname !== '/app/') || !/^[0-9a-f-]{36}$/i.test(url.searchParams.get('binder') ?? '')) return '/app'
    return `/app?binder=${encodeURIComponent(url.searchParams.get('binder'))}`
  } catch { return '/app' }
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload
    try { payload = event.data?.json() } catch { payload = null }
    const account = await notificationAccount()
    const isTest = account && account === payload?.recipientId && payload?.kind === 'test'
    let preview = isTest ? { title: 'Notifications are on', body: 'This device is ready for partner updates.', url: '/app' } : null
    if (!isTest && account && account === payload?.recipientId && /^[0-9a-f-]{36}$/i.test(payload?.eventId ?? '')) {
      try {
        const response = await fetch(`/app/api/push/events/${payload.eventId}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (response.ok) preview = await response.json()
      } catch { /* Offline or signed out: keep the visible notification private. */ }
    }
    await self.registration.showNotification(preview ? String(preview.title ?? 'Holo Folder update').slice(0, 160) : 'Holo Folder update', {
      body: preview ? String(preview.body ?? '').slice(0, 240) : 'Open the app to see your update.',
      icon: '/app/pwa-holo-cards-192.png', badge: '/app/icon-light-32x32.png',
      tag: typeof payload?.tag === 'string' ? payload.tag.slice(0, 100) : 'binderdex-update',
      ...(isTest ? { renotify: true } : {}),
      data: { url: preview ? notificationDestination(preview.url) : '/app', recipientId: preview ? account : null, eventId: preview ? payload.eventId : null },
    })
  })())
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil((async () => {
    const account = await notificationAccount()
    let url = '/app'
    if (account && account === event.notification.data?.recipientId && /^[0-9a-f-]{36}$/i.test(event.notification.data?.eventId ?? '')) {
      try {
        const response = await fetch(`/app/api/push/events/${event.notification.data.eventId}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(5000) })
        if (response.ok) url = notificationDestination((await response.json()).url)
      } catch { /* Open the normal authenticated app when the update cannot be verified. */ }
    }
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find(client => {
      const current = new URL(client.url)
      return current.origin === self.location.origin && /^\/app(?:\/|$)/.test(current.pathname)
    })
    if (existing) { await existing.navigate(url); await existing.focus() }
    else await self.clients.openWindow(url)
  })())
})
