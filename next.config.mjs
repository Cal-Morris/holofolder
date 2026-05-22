import { withWorkflow } from "workflow/next"

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
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
