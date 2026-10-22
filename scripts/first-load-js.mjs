// First-load JS per app route. Turbopack's `next build` no longer prints it, so this reads .next:
// the root main files plus each route's entry chunks from its client-reference manifest (lazy
// next/dynamic chunks aren't included). Run after `bun run build`: `bun run analyze:first-load`.
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import zlib from "node:zlib"

const root = process.argv[2] || ".next"
const buildManifest = JSON.parse(fs.readFileSync(path.join(root, "build-manifest.json"), "utf8"))
const sizes = new Map()

function fileSize(chunk) {
  const file = path.join(root, chunk.replace(/^\/_next\//, ""))
  if (!sizes.has(file)) {
    const bytes = fs.readFileSync(file)
    sizes.set(file, [bytes.length, zlib.gzipSync(bytes, { level: 9 }).length])
  }
  return sizes.get(file)
}

function findManifests(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) findManifests(full, found)
    else if (entry.name.endsWith("page_client-reference-manifest.js")) found.push(full)
  }
  return found
}

const rows = []
for (const manifestFile of findManifests(path.join(root, "server/app"))) {
  const context = { globalThis: {} }
  vm.runInNewContext(fs.readFileSync(manifestFile, "utf8"), context)
  for (const [route, manifest] of Object.entries(context.globalThis.__RSC_MANIFEST)) {
    if (route.includes("e2e-harness") || route.includes("_global-error")) continue
    const chunks = new Set(buildManifest.rootMainFiles.map((file) => `/_next/${file}`))
    for (const list of Object.values(manifest.entryJSFiles || {})) {
      for (const chunk of list) chunks.add(chunk.startsWith("/") ? chunk : `/_next/${chunk}`)
    }
    let raw = 0
    let gzip = 0
    for (const chunk of chunks) {
      const [r, g] = fileSize(chunk)
      raw += r
      gzip += g
    }
    rows.push([route.replace(/\/page$/, "") || "/", Math.round(raw / 1024), Math.round(gzip / 1024)])
  }
}

rows.sort((a, b) => a[0].localeCompare(b[0]))
console.log("route\traw_kB\tgzip_kB")
for (const row of rows) console.log(row.join("\t"))
