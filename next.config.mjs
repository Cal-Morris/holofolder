import { withWorkflow } from "workflow/next"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    "localhost",
    "10.4.1.154",
  ],
  cacheComponents: true,
  turbopack: {
    root: projectRoot,
  },
  images: {
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

export default withWorkflow(nextConfig)
