import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const rootDir = process.cwd()
const publicDir = path.join(rootDir, "public")

const lightTheme = {
  bg: "#fff7eb",
  shadow: "#1d27380f",
  binder: "#e04e39",
  ring: "#fff4ef",
  cardBack: "#ffd89f",
  cardFront: "#fffdf8",
  stroke: "#243047",
  badge: "#5aa9ff",
  line: "#243047",
}

const darkTheme = {
  bg: "#151b26",
  shadow: "#00000028",
  binder: "#ff6b4a",
  ring: "#ffe2d8",
  cardBack: "#f2bd63",
  cardFront: "#fff4df",
  stroke: "#ecf3ff",
  badge: "#7ab8ff",
  line: "#243047",
}

function themedSvg(theme) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="512" height="512" rx="118" fill="${theme.bg}" />
  <rect x="205" y="120" width="184" height="242" rx="32" transform="rotate(-7 205 120)" fill="${theme.shadow}" />
  <rect x="102" y="96" width="126" height="320" rx="34" fill="${theme.binder}" />
  <circle cx="165" cy="178" r="15" fill="${theme.ring}" />
  <circle cx="165" cy="256" r="15" fill="${theme.ring}" />
  <circle cx="165" cy="334" r="15" fill="${theme.ring}" />
  <rect x="226" y="114" width="184" height="242" rx="32" transform="rotate(-7 226 114)" fill="${theme.cardBack}" stroke="${theme.stroke}" stroke-width="14" />
  <rect x="180" y="164" width="188" height="244" rx="32" transform="rotate(4 180 164)" fill="${theme.cardFront}" stroke="${theme.stroke}" stroke-width="14" />
  <circle cx="284" cy="242" r="34" fill="${theme.badge}" />
  <rect x="236" y="298" width="96" height="18" rx="9" fill="${theme.line}" />
  <rect x="224" y="332" width="120" height="18" rx="9" fill="${theme.line}" />
  <path d="M300 146L310.5 168.5L333 179L310.5 189.5L300 212L289.5 189.5L267 179L289.5 168.5L300 146Z" fill="${theme.cardFront}" stroke="${theme.stroke}" stroke-width="12" stroke-linejoin="round" />
</svg>
`
}

function adaptiveSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <style>
    :root {
      --bg: ${lightTheme.bg};
      --shadow: ${lightTheme.shadow};
      --binder: ${lightTheme.binder};
      --ring: ${lightTheme.ring};
      --card-back: ${lightTheme.cardBack};
      --card-front: ${lightTheme.cardFront};
      --stroke: ${lightTheme.stroke};
      --badge: ${lightTheme.badge};
      --line: ${lightTheme.line};
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: ${darkTheme.bg};
        --shadow: ${darkTheme.shadow};
        --binder: ${darkTheme.binder};
        --ring: ${darkTheme.ring};
        --card-back: ${darkTheme.cardBack};
        --card-front: ${darkTheme.cardFront};
        --stroke: ${darkTheme.stroke};
        --badge: ${darkTheme.badge};
        --line: ${darkTheme.line};
      }
    }
  </style>
  <rect width="512" height="512" rx="118" fill="var(--bg)" />
  <rect x="205" y="120" width="184" height="242" rx="32" transform="rotate(-7 205 120)" fill="var(--shadow)" />
  <rect x="102" y="96" width="126" height="320" rx="34" fill="var(--binder)" />
  <circle cx="165" cy="178" r="15" fill="var(--ring)" />
  <circle cx="165" cy="256" r="15" fill="var(--ring)" />
  <circle cx="165" cy="334" r="15" fill="var(--ring)" />
  <rect x="226" y="114" width="184" height="242" rx="32" transform="rotate(-7 226 114)" fill="var(--card-back)" stroke="var(--stroke)" stroke-width="14" />
  <rect x="180" y="164" width="188" height="244" rx="32" transform="rotate(4 180 164)" fill="var(--card-front)" stroke="var(--stroke)" stroke-width="14" />
  <circle cx="284" cy="242" r="34" fill="var(--badge)" />
  <rect x="236" y="298" width="96" height="18" rx="9" fill="var(--line)" />
  <rect x="224" y="332" width="120" height="18" rx="9" fill="var(--line)" />
  <path d="M300 146L310.5 168.5L333 179L310.5 189.5L300 212L289.5 189.5L267 179L289.5 168.5L300 146Z" fill="var(--card-front)" stroke="var(--stroke)" stroke-width="12" stroke-linejoin="round" />
</svg>
`
}

function rasterizeSvg(svgPath, size, outputPath) {
  execFileSync("sips", [
    "-s",
    "format",
    "png",
    svgPath,
    "-z",
    String(size),
    String(size),
    "--out",
    outputPath,
  ], { stdio: "inherit" })
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

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "binderdex-icons-"))
const lightSvgPath = path.join(tempDir, "icon-light.svg")
const darkSvgPath = path.join(tempDir, "icon-dark.svg")

try {
  fs.writeFileSync(lightSvgPath, themedSvg(lightTheme))
  fs.writeFileSync(darkSvgPath, themedSvg(darkTheme))

  rasterizeSvg(lightSvgPath, 32, path.join(publicDir, "icon-light-32x32.png"))
  rasterizeSvg(darkSvgPath, 32, path.join(publicDir, "icon-dark-32x32.png"))
  rasterizeSvg(lightSvgPath, 180, path.join(publicDir, "apple-icon.png"))
  rasterizeSvg(lightSvgPath, 192, path.join(publicDir, "pwa-192x192.png"))
  rasterizeSvg(lightSvgPath, 512, path.join(publicDir, "pwa-512x512.png"))
  createIcoFromPng(path.join(publicDir, "icon-light-32x32.png"), path.join(publicDir, "favicon.ico"))
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true })
}
