import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { config } from "../proxy"

// Next.js anchors the matcher to the whole pathname.
const matcher = new RegExp(`^${config.matcher[0]}$`)
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
