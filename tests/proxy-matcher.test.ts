import { describe, it, test } from "node:test"
import assert from "node:assert/strict"
import { config } from "../proxy"

// Next.js anchors the matcher to the whole pathname.
const matcher = new RegExp(`^${config.matcher[1]}$`)
const runsProxy = (pathname: string) => matcher.test(pathname)

describe("proxy matcher", () => {
  it("refreshes the session for pages and signed-in API routes", () => {
    for (const path of ["/", "/home", "/studio", "/auth/login", "/share/abc", "/api/collection", "/api/settings", "/api/card-prices/refresh"]) {
      assert.equal(runsProxy(path), true, path)
    }
  })

  it("skips static files, the offline shell and public catalog routes", () => {
    for (const path of [
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/sw.js",
      "/manifest.webmanifest",
      "/app-shell",
      "/favicon.ico",
      "/icon.svg",
      "/pwa-192x192.png",
      "/binder-presets/classic.png",
      "/api/card-image-proxy",
      "/api/card-prices",
      "/api/tcgdex-cache",
      "/api/tcg-set-slots",
      "/api/tcg-card-search",
      "/api/ebay/account-deletion",
      "/.well-known/workflow/v1/step",
    ]) {
      assert.equal(runsProxy(path), false, path)
    }
  })
})

test("worker script can be served from slashless /app without an authenticated session", async () => {
  const { NextRequest } = await import("next/server")
  const { proxy } = await import("../proxy")
  const request = new NextRequest("https://holofolder.com/app?service-worker=1", { nextConfig: { basePath: "/app" } })
  const response = await proxy(request)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("x-middleware-rewrite"), "https://holofolder.com/app/sw.js")
})

test("public share responses disable browser and CDN storage without loading the visitor's session", async () => {
  const { NextRequest } = await import("next/server")
  const { proxy } = await import("../proxy")
  for (const path of ["/share/synthetic-token", "/u/synthetic-owner/national"]) {
    const request = new NextRequest(`https://holofolder.com/app${path}`, { nextConfig: { basePath: "/app" } })
    const response = await proxy(request)
    assert.equal(response.status, 200)
    for (const header of ["cache-control", "cdn-cache-control", "vercel-cdn-cache-control"]) {
      assert.match(response.headers.get(header) ?? "", /no-store/)
    }
    assert.equal(response.cookies.getAll().length, 0)
  }
})
