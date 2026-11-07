import sharp from "sharp"
import fs from "node:fs"
import path from "node:path"

const publicDir = path.join(process.cwd(), "public")
const vector = fs.readFileSync("assets/brand/holo-cards-mark.svg", "utf8")
const master = await sharp(Buffer.from(vector), { density: 192 }).trim().png().toBuffer()
const lightBackground = "#f7f5ff"
const darkBackground = "#171a22"

async function appIcon(size, background, maskable = false) {
  // A square at 56% fits entirely inside Android's 80%-diameter maskable safe circle.
  const extent = Math.round(size * (maskable ? .56 : .84))
  const mark = await sharp(master).resize({ width: extent, height: extent, fit: "inside" }).png().toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: "centre" }]).removeAlpha().png({ palette: true, effort: 10 }).toBuffer()
}

async function createIco(file) {
  const sizes = [16, 32, 48, 64]
  const images = await Promise.all(sizes.map(size => appIcon(size, lightBackground)))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(sizes.length, 4)
  let offset = 6 + sizes.length * 16
  const entries = images.map((png, index) => {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(sizes[index], 0)
    entry.writeUInt8(sizes[index], 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += png.length
    return entry
  })
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...images]))
}

const outputs = [
  ["holo-cards-light-32.png", 32, lightBackground],
  ["holo-cards-dark-32.png", 32, darkBackground],
  ["apple-touch-icon-holo-cards.png", 180, lightBackground],
  ["pwa-holo-cards-192.png", 192, lightBackground],
  ["pwa-holo-cards-512.png", 512, lightBackground],
  ["pwa-holo-cards-1024.png", 1024, lightBackground],
  ["pwa-holo-cards-dark-512.png", 512, darkBackground],
  ["pwa-holo-cards-maskable-192.png", 192, lightBackground, true],
  ["pwa-holo-cards-maskable-512.png", 512, lightBackground, true],
]
for (const [name, size, background, maskable] of outputs) fs.writeFileSync(path.join(publicDir, name), await appIcon(size, background, maskable))

for (const [source, aliases] of [
  ["holo-cards-light-32.png", ["icon-light-32x32.png"]],
  ["holo-cards-dark-32.png", ["icon-dark-32x32.png"]],
  ["apple-touch-icon-holo-cards.png", ["apple-icon.png", "apple-touch-icon-holo-card.png"]],
  ["pwa-holo-cards-maskable-192.png", ["pwa-192x192.png", "pwa-holo-card-192.png"]],
  ["pwa-holo-cards-maskable-512.png", ["pwa-512x512.png", "pwa-holo-card-512.png"]],
]) for (const alias of aliases) fs.copyFileSync(path.join(publicDir, source), path.join(publicDir, alias))

await sharp(master).resize({ width: 192, height: 192, fit: "contain", background: "#00000000" }).png({ palette: true, effort: 10 }).toFile(path.join(publicDir, "holo-cards-mark.png"))
fs.copyFileSync(path.join(publicDir, "holo-cards-mark.png"), path.join(publicDir, "holo-card-mark.png"))
fs.writeFileSync(path.join(publicDir, "holo-cards-mark.svg"), vector)
const artwork = vector.replace(/<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "")
function vectorIcon(background, styles = "", scale = .84) {
  const inset = (512 - 512 * scale) / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><style>${styles}</style>${background}<g transform="translate(${inset} ${inset}) scale(${scale})">${artwork}</g></svg>\n`
}
const adaptive = vectorIcon('<rect width="512" height="512" fill="var(--bg)"/>', `:root{--bg:${lightBackground}}@media(prefers-color-scheme:dark){:root{--bg:${darkBackground}}}`)
for (const name of ["holo-cards-icon.svg", "icon.svg"]) fs.writeFileSync(path.join(publicDir, name), adaptive)
fs.writeFileSync(path.join(publicDir, "holo-cards-light.svg"), vectorIcon(`<rect width="512" height="512" fill="${lightBackground}"/>`))
fs.writeFileSync(path.join(publicDir, "holo-cards-dark.svg"), vectorIcon(`<rect width="512" height="512" fill="${darkBackground}"/>`))
fs.writeFileSync(path.join(publicDir, "holo-cards-maskable.svg"), vectorIcon(`<rect width="512" height="512" fill="${lightBackground}"/>`, "", .56))
fs.writeFileSync(path.join(publicDir, "holo-cards-glass.svg"), vectorIcon("", ".card-face{fill-opacity:.55}.card-border{fill-opacity:.7}"))
const monochrome = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><mask id="rear"><rect width="512" height="512" fill="white"/><rect x="135" y="75" width="242" height="352" rx="30" fill="black"/></mask></defs><g fill="none" stroke="black" stroke-width="20" stroke-linejoin="round" mask="url(#rear)"><rect x="91" y="103" width="210" height="300" rx="24" transform="rotate(-15 196 253)"/><rect x="211" y="103" width="210" height="300" rx="24" transform="rotate(15 316 253)"/></g><rect x="151" y="91" width="210" height="320" rx="24" fill="none" stroke="black" stroke-width="20"/><path d="M256 175Q266 241 320 251Q266 261 256 327Q246 261 192 251Q246 241 256 175" fill="black"/></svg>\n'
fs.writeFileSync(path.join(publicDir, "holo-cards-monochrome.svg"), monochrome)
await createIco(path.join(publicDir, "holo-cards-favicon.ico"))
fs.copyFileSync(path.join(publicDir, "holo-cards-favicon.ico"), path.join(publicDir, "favicon.ico"))
