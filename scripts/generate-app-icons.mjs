import sharp from "sharp"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const rootDir = process.cwd()
const publicDir = path.join(rootDir, "public")

const lightTheme = { bg: "#f7f5ff", stroke: "#433878" }
const darkTheme = { bg: "#171a22", stroke: "#eee8ff" }

function themedSvg(theme, adaptive = false) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root { --bg: ${theme.bg}; --stroke: ${theme.stroke}; }
    ${adaptive ? `@media (prefers-color-scheme: dark) { :root { --bg: ${darkTheme.bg}; --stroke: ${darkTheme.stroke}; } }` : ""}
  </style>
  <defs>
    <linearGradient id="holo" x1="92" y1="160" x2="416" y2="390" gradientUnits="userSpaceOnUse">
      <stop stop-color="#a5b4fc"/><stop offset=".35" stop-color="#f0abfc"/>
      <stop offset=".65" stop-color="#67e8f9"/><stop offset="1" stop-color="#c4b5fd"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="118" fill="${adaptive ? "var(--bg)" : theme.bg}"/>
  <path d="M88 180V150C88 133 101 120 118 120H213L245 157H394C411 157 424 170 424 187V357C424 376 409 392 390 392H122C103 392 88 376 88 357V180Z" fill="url(#holo)" stroke="${adaptive ? "var(--stroke)" : theme.stroke}" stroke-width="14" stroke-linejoin="round"/>
  <rect x="200" y="170" width="126" height="168" rx="16" transform="rotate(9 200 170)" fill="#faf5ff" stroke="${adaptive ? "var(--stroke)" : theme.stroke}" stroke-width="12"/>
  <path d="M92 234H420L398 365C395 381 382 392 366 392H146C130 392 117 381 114 365L92 234Z" fill="url(#holo)" stroke="${adaptive ? "var(--stroke)" : theme.stroke}" stroke-width="14" stroke-linejoin="round"/>
  <path d="M262 269L274 295L300 307L274 319L262 345L250 319L224 307L250 295L262 269Z" fill="#fff" stroke="${adaptive ? "var(--stroke)" : theme.stroke}" stroke-width="10" stroke-linejoin="round"/>
</svg>
`
}

function adaptiveSvg() { return themedSvg(lightTheme, true) }

async function rasterizeSvg(svgPath, size, outputPath) {
  await sharp(fs.readFileSync(svgPath)).resize(size, size).png().toFile(outputPath)
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

fs.writeFileSync(path.join(publicDir, "icon.svg"), adaptiveSvg())

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "holofolder-icons-"))
const lightSvgPath = path.join(tempDir, "icon-light.svg")
const darkSvgPath = path.join(tempDir, "icon-dark.svg")

try {
  fs.writeFileSync(lightSvgPath, themedSvg(lightTheme))
  fs.writeFileSync(darkSvgPath, themedSvg(darkTheme))

  await rasterizeSvg(lightSvgPath, 32, path.join(publicDir, "icon-light-32x32.png"))
  await rasterizeSvg(darkSvgPath, 32, path.join(publicDir, "icon-dark-32x32.png"))
  await rasterizeSvg(lightSvgPath, 180, path.join(publicDir, "apple-icon.png"))
  await rasterizeSvg(lightSvgPath, 192, path.join(publicDir, "pwa-192x192.png"))
  await rasterizeSvg(lightSvgPath, 512, path.join(publicDir, "pwa-512x512.png"))
  createIcoFromPng(path.join(publicDir, "icon-light-32x32.png"), path.join(publicDir, "favicon.ico"))
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
