const CACHE_VERSION = "binderdex-v2"
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`
const NAVIGATION_CACHE = `${CACHE_VERSION}-navigation`
const DATA_CACHE = `${CACHE_VERSION}-data`
const IMAGE_CACHE = `${CACHE_VERSION}-images`

const APP_SHELL_ASSETS = [
  "/",
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

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request)
  if (cached) {
    return cached
  }

  const response = await fetch(request)
  if (isCacheableResponse(response)) {
    cache.put(request, response.clone())
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

async function networkFirst(request, cacheName, fallback) {
  const cache = await caches.open(cacheName)

  try {
    const response = await fetch(request)
    if (isCacheableResponse(response)) {
      cache.put(request, response.clone())
    }
    return response
  } catch (error) {
    const cached = await cache.match(request)
    if (cached) {
      return cached
    }

    if (typeof fallback === "function") {
      const fallbackResponse = await fallback()
      if (fallbackResponse) {
        return fallbackResponse
      }
    }

    throw error
  }
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
            .filter((key) => key.startsWith("binderdex-") && !key.startsWith(CACHE_VERSION))
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
})

self.addEventListener("fetch", (event) => {
  const { request } = event

  if (request.method !== "GET") {
    return
  }

  const url = new URL(request.url)

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request, NAVIGATION_CACHE, async () => {
        return (await caches.match(request)) || caches.match("/")
      }),
    )
    return
  }

  if (
    request.destination === "image" ||
    url.pathname.startsWith("/api/card-image-proxy")
  ) {
    event.respondWith(cacheFirst(request, IMAGE_CACHE))
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
      url.pathname.startsWith("/api/card-prices")
    )
  ) {
    event.respondWith(networkFirst(request, DATA_CACHE))
    return
  }

  if (url.origin !== self.location.origin && request.destination === "image") {
    event.respondWith(cacheFirst(request, IMAGE_CACHE))
  }
})
