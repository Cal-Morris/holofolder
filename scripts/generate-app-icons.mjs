import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"

const publicDir = path.join(process.cwd(), "public")
const master = await sharp("assets/brand/holo-card-master.png").trim().png().toBuffer()
const lightBackground = "#f7f5ff"
const darkBackground = "#171a22"

async function appIcon(size, background) {
  // Keep the entire card inside Android's maskable safe circle; iOS supplies its own corner mask.
  const mark = await sharp(master).resize({ width: Math.round(size * .66), height: Math.round(size * .66), fit: "inside" }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }]).removeAlpha().png({ palette: true, effort: 10 }).toBuffer()
}

function createIcoFromPng(pngPath, icoPath) {
  const pngBytes = fs.readFileSync(pngPath)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry.writeUInt8(32, 0)
  entry.writeUInt8(32, 1)
  entry.writeUInt8(0, 2)
  entry.writeUInt8(0, 3)
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(pngBytes.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  fs.writeFileSync(icoPath, Buffer.concat([header, entry, pngBytes]))
}

const outputs = [
  ["icon-light-32x32.png", 32, lightBackground],
  ["icon-dark-32x32.png", 32, darkBackground],
  ["apple-icon.png", 180, lightBackground],
  ["pwa-192x192.png", 192, lightBackground],
  ["pwa-512x512.png", 512, lightBackground],
]
for (const [name, size, background] of outputs) {
  fs.writeFileSync(path.join(publicDir, name), await appIcon(size, background))
}
// New install URLs bypass OS/browser caches; old URLs keep working for existing bookmarks.
for (const [source, target] of [["apple-icon.png", "apple-touch-icon-holo-card.png"], ["pwa-192x192.png", "pwa-holo-card-192.png"], ["pwa-512x512.png", "pwa-holo-card-512.png"]]) {
  fs.copyFileSync(path.join(publicDir, source), path.join(publicDir, target))
}
await sharp(master).resize({ width: 96, height: 96, fit: "contain", background: "#00000000" }).png({ palette: true, effort: 10 }).toFile(path.join(publicDir, "holo-card-mark.png"))
const smallMark = await sharp(master).resize({ width: 128, height: 128, fit: "inside" }).png({ palette: true, effort: 10 }).toBuffer()
const markMetadata = await sharp(smallMark).metadata()
const width = Math.round(markMetadata.width / markMetadata.height * 338)
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><style>:root{--bg:${lightBackground}}@media(prefers-color-scheme:dark){:root{--bg:${darkBackground}}}</style><rect width="512" height="512" fill="var(--bg)"/><image x="${(512-width)/2}" y="87" width="${width}" height="338" href="data:image/png;base64,${smallMark.toString("base64")}"/></svg>\n`
fs.writeFileSync(path.join(publicDir, "icon.svg"), svg)
createIcoFromPng(path.join(publicDir, "icon-light-32x32.png"), path.join(publicDir, "favicon.ico"))
