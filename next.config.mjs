import { withWorkflow } from "workflow/next"
import { createMDX } from "fumadocs-mdx/next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/app",
  async redirects() {
    return [{
      source: "/:path((?!app(?:/|$)|sw\\.js$|api/ebay/account-deletion$).*)",
      has: [{ type: "host", value: "binder.cal.gg" }],
      destination: "https://binder.cal.gg/app/:path",
      basePath: false,
      permanent: false,
    }]
  },
  async rewrites() {
    // Binder addresses (lib/binders/url.ts) render the app at `/`. afterFiles: real routes always win.
    const slug = ":binderSlug((?!api$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)"
    const afterFiles = [`/${slug}`, `/${slug}/:view(binder|list|slabs)`, `/${slug}/binder/:page(\\d{1,4})`]
      .map(source => ({ source, destination: "/?binderSlug=:binderSlug" }))
    return { afterFiles, beforeFiles: ["/sw.js", "/api/ebay/account-deletion"].map(source => ({
      source,
      has: [{ type: "host", value: "binder.cal.gg" }],
      destination: `https://app.holofolder.com/app${source}`,
      basePath: false,
    })) }
  },
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Service-Worker-Allowed", value: "/" }, { key: "Cache-Control", value: "no-cache" }] }]
  },
  allowedDevOrigins: [
    "localhost",
    "10.4.1.154",
  ],
  cacheComponents: true,
  typescript: {
    // Typecheck CI checks the full repo; keep local builds checked too.
    ignoreBuildErrors: process.env.VERCEL === "1",
  },
  turbopack: {
    root: projectRoot,
  },
  images: {
    // Card scans top out at 600px; smaller candidates match the image proxy's widths.
    deviceSizes: [600],
    imageSizes: [96, 160, 240, 320, 480],
    minimumCacheTTL: 60 * 60 * 24 * 30,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.tcgdex.net",
      },
      {
        protocol: "https",
        hostname: "**.tcgdex.net",
      },
    ],
  },
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@workflow/world-postgres/**/*",
      "./node_modules/@vercel/queue/**/*",
      "./node_modules/cbor-x/**/*",
      "./node_modules/drizzle-orm/**/*",
      "./node_modules/graphile-worker/**/*",
    ],
  },
}

export default withWorkflow(await createMDX()(nextConfig))
