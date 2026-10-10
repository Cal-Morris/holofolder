const CACHE_VERSION = "binderdex-v4"
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const DATA_CACHE = `${CACHE_VERSION}-data`
// Images keep their v3 name so the cards people already cached survive this upgrade.
const IMAGE_CACHE = "binderdex-v3-images"
const KEEP_CACHES = [APP_SHELL_CACHE, DATA_CACHE, IMAGE_CACHE]
const WARM_CACHE_MESSAGE_TYPE = "BINDERDEX_WARM_CACHE"
const MAX_WARM_CACHE_URLS = 500
const WARM_CACHE_CONCURRENCY = 4
// Oldest entries are evicted beyond this (card images are ~20-200 KB each).
const MAX_IMAGE_CACHE_ENTRIES = 1500

// Static, user-independent page that boots the binder from local data (app/app-shell).
// Served for any navigation the network can't answer, instead of a per-user cached "/".
const APP_SHELL_URL = "/app-shell"
// On weak Wi-Fi, stop waiting for the server after this long and open the offline shell.
// Only for the app's own entry pages: auth callbacks, share links etc. always wait for the server.
const NAVIGATION_TIMEOUT_MS = 6000
const APP_ENTRY_PATHS = ["/", APP_SHELL_URL]
const APP_SHELL_REFRESH_INTERVAL_MS = 10 * 60 * 1000
let lastAppShellRefreshAt = 0

const APP_SHELL_ASSETS = [
  "/favicon.ico",
  "/manifest.webmanifest",
  "/apple-icon.png",
  "/icon.svg",
  "/icon-light-32x32.png",
  "/icon-dark-32x32.png",
  "/pwa-192x192.png",
  "/pwa-512x512.png",
]

function isCacheableResponse(response) {
  return Boolean(response) && (response.ok || response.type === "opaque")
}

function isImagePath(pathname) {
  return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(pathname)
}

function getCacheNameForUrl(url) {
  if (
    url.pathname.startsWith("/api/card-image-proxy") ||
    isImagePath(url.pathname)
  ) {
    return IMAGE_CACHE
  }

  if (
    url.pathname.startsWith("/api/tcgdex-cache") ||
    url.pathname.startsWith("/api/tcg-set-slots") ||
    url.pathname.startsWith("/api/tcg-card-search") ||
    url.pathname.startsWith("/api/card-prices")
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

async function cacheFirst(request, cacheName, event) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  const response = await fetch(request)
  if (isCacheableResponse(response)) {
    const write = putInCache(cache, cacheName, request, response.clone()).catch(() => undefined)
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
  const cached = await cache.match(request)

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
    const match = tag.match(/\b(?:src|href)="(\/_next\/static\/[^"?]+\.(?:js|css|woff2)(?:\?[^"]*)?)"/)
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
  const canUseShell = url.origin === self.location.origin && !url.pathname.startsWith("/auth/") && !url.pathname.startsWith("/share/")
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
  if (url.origin === self.location.origin && (url.pathname === "/" || url.pathname === APP_SHELL_URL)) {
    if (!(await getOfflineAppShell())) {
      await precacheAppShell()
    }
    return
  }

  const request = new Request(url.toString(), {
    credentials: url.origin === self.location.origin ? "same-origin" : "omit",
  })
  const cacheName = getCacheNameForUrl(url)
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
    event.respondWith(handleNavigation(event))
    return
  }

  if (
    request.destination === "image" ||
    url.pathname.startsWith("/api/card-image-proxy")
  ) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, event))
    return
  }

  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/_next/image") ||
      APP_SHELL_ASSETS.includes(url.pathname)
    )
  ) {
    event.respondWith(staleWhileRevalidate(request, APP_SHELL_CACHE))
    return
  }

  if (
    url.origin === self.location.origin &&
    (
      url.pathname.startsWith("/api/tcgdex-cache") ||
      url.pathname.startsWith("/api/tcg-set-slots") ||
      url.pathname.startsWith("/api/tcg-card-search") ||
      url.pathname.startsWith("/api/card-prices")
    )
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE, event))
    return
  }

  if (url.origin !== self.location.origin && request.destination === "image") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE, event))
  }
})
