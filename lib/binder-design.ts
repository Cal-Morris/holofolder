import { BINDER_COLOR_PRESETS } from "@/lib/binder-colors"
import type { BinderSettings } from "@/lib/settings"

export const DESIGN_SURFACES = ["cover", "back", "spine", "lining"] as const
export type DesignSurface = typeof DESIGN_SURFACES[number]
export type BinderPart = DesignSurface | "pages" | "zip"
export type BinderView = "front" | "back" | "spine" | "inside" | "detail"
export interface ArtworkFrame { fit: "fit" | "fill"; zoom: number; x: number; y: number }
export interface SurfaceDesign { color: string; words: string; artwork: string | null; frame: ArtworkFrame }
export interface BinderDesign {
  version: 1
  name: string
  surfaces: Record<DesignSurface, SurfaceDesign>
  material: "pebbled" | "smooth"
  ink: string
  font: "sans-serif" | "serif" | "monospace"
  textSize: number
  pageCount: number
  rows: number
  cols: number
  pageColor: string
  pageColors: Record<string, string>
  zip: { teeth: string; tape: string; pull: string; type: "metal" | "nylon" }
  stats: "off" | "compact" | "full"
}
export interface StudioCard { id: string; name: string; image: string; slot?: number }
export interface BinderStats { placed: number; wanted: number; capacity: number; sample: boolean; filled: number; unavailable?: boolean }
const frame: ArtworkFrame = { fit: "fill", zoom: 1, x: 0, y: 0 }
const number = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback
const color = (v: unknown, fallback: string) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : fallback
const text = (v: unknown, fallback: string, max = 100) => typeof v === "string" ? v.slice(0, max) : fallback
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}
export function normalizeArtworkFrame(value: unknown): ArtworkFrame {
  const v = object(value)
  return { fit: v.fit === "fit" ? "fit" : "fill", zoom: number(v.zoom, 1, .25, 4), x: number(v.x, 0, -1, 1), y: number(v.y, 0, -1, 1) }
}
export function isCardArtworkUrl(value: unknown): value is string {
  if (typeof value !== "string") return false
  try {
    const url = new URL(value, "https://binder.local")
    if (url.origin !== "https://binder.local" || url.pathname !== "/api/card-image-proxy") return false
    const src = new URL(url.searchParams.get("url") || "")
    return src.protocol === "https:" && src.hostname === "assets.tcgdex.net" && !src.username && !src.password && src.port === ""
  } catch { return false }
}
export function defaultBinderDesign(settings?: BinderSettings): BinderDesign {
  const presetColor = (id: string) => BINDER_COLOR_PRESETS.find(p => p.id === id)?.swatch[0] ?? "#222222"
  const pageColors: Record<string, string> = {}
  for (const [page, id] of Object.entries(settings?.binderPageColors ?? {})) pageColors[page] = presetColor(id)
  return {
    version: 1, name: "National Dex", surfaces: Object.fromEntries(DESIGN_SURFACES.map(s => [s, { color: s === "lining" ? "#242424" : "#33353b", words: s === "spine" ? "National Dex" : "", artwork: null, frame: { ...frame } }])) as BinderDesign["surfaces"],
    material: "pebbled", ink: "#eeeae2", font: "sans-serif", textSize: 60, pageCount: settings ? Math.ceil(1025 / (settings.binderRows * settings.binderCols)) : 20,
    rows: settings?.binderRows ?? 4, cols: settings?.binderCols ?? 4,
    pageColor: settings ? presetColor(settings.binderColorId) : "#202124", pageColors,
    zip: { teeth: "#a8a9ac", tape: "#28292d", pull: "#b8b9bc", type: "metal" }, stats: "compact",
  }
}
export function normalizeBinderDesign(value: unknown, defaults = defaultBinderDesign()): BinderDesign {
  const v = object(value), surfaces = object(v.surfaces), zip = object(v.zip), pages = object(v.pageColors)
  const pageColors: Record<string, string> = {}
  for (const [key, val] of Object.entries(pages)) if (/^\d+$/.test(key) && Number(key) >= 1 && Number(key) <= 1025 && /^#[0-9a-f]{6}$/i.test(String(val))) pageColors[key] = String(val)
  return {
    version: 1, name: text(v.name, defaults.name),
    surfaces: Object.fromEntries(DESIGN_SURFACES.map(s => {
      const d = object(surfaces[s]), fallback = defaults.surfaces[s]
      const artwork = typeof d.artwork === "string" && (/^upload:[a-z0-9-]+$/i.test(d.artwork) || isCardArtworkUrl(d.artwork)) ? d.artwork : null
      return [s, { color: color(d.color, fallback.color), words: text(d.words, fallback.words, 240), artwork, frame: normalizeArtworkFrame(d.frame) }]
    })) as BinderDesign["surfaces"],
    material: v.material === "smooth" ? "smooth" : "pebbled", ink: color(v.ink, defaults.ink),
    font: v.font === "serif" || v.font === "monospace" ? v.font : "sans-serif", textSize: number(v.textSize, 60, 20, 150),
    pageCount: Math.round(number(v.pageCount, defaults.pageCount, 1, 1025)), rows: Math.round(number(v.rows, defaults.rows, 1, 4)), cols: Math.round(number(v.cols, defaults.cols, 1, 4)),
    pageColor: color(v.pageColor, defaults.pageColor), pageColors,
    zip: { teeth: color(zip.teeth, defaults.zip.teeth), tape: color(zip.tape, defaults.zip.tape), pull: color(zip.pull, defaults.zip.pull), type: zip.type === "nylon" ? "nylon" : "metal" },
    stats: v.stats === "off" || v.stats === "full" ? v.stats : "compact",
  }
}
export const BINDER_LAYERS = { leafPitch: .0085, backing: .001, card: .0032, film: .00035, cover: .032 } as const
export function binderDimensions(pageCount: number) {
  const faces = Math.round(number(pageCount, 32, 1, 1025)), leaves = Math.ceil(faces / 2)
  // shortcut: proportional loaded-leaf pitch, replace with measurements of the chosen physical binder model.
  const stack = leaves * BINDER_LAYERS.leafPitch
  return { faces, leaves, stack, coverZ: stack / 2 + .04, depth: stack + .12 }
}
export function binderSpread(page: number, pageCount: number) {
  const faces = Math.round(number(pageCount, 32, 1, 1025)), selected = Math.round(number(page, 1, 1, faces)), turnedLeaves = Math.floor(selected / 2)
  return { selected, turnedLeaves, left: turnedLeaves * 2, right: turnedLeaves * 2 + 1 <= faces ? turnedLeaves * 2 + 1 : 0 }
}
export function binderTurnPage(page: number, pageCount: number, direction: -1 | 1) {
  const spread = binderSpread(page, pageCount), last = binderSpread(pageCount, pageCount)
  const leaves = Math.max(0, Math.min(last.turnedLeaves, spread.turnedLeaves + direction))
  return leaves === spread.turnedLeaves ? spread.selected : Math.max(1, leaves * 2)
}
export const BINDER_PAGE = { hingeX: -1.3, inset: .23, width: 2.25, height: 3.13 } as const
export function binderPocket(rows: number, cols: number, index: number, side: 1 | -1) {
  const w = 2.15 / cols, h = 3.02 / rows, column = index % cols, row = Math.floor(index / cols)
  const x = BINDER_PAGE.inset + (side === 1 ? .05 + w * (column + .5) : 2.20 - w * (column + .5))
  return { x, y: 1.51 - h * (row + .5), w, h }
}
export function pageTurnPoint(x: number, z: number, width: number, progress: number) {
  const p = number(progress, 0, 0, 1), angle = -Math.PI * p
  const flex = Math.sin(Math.PI * p), localX = x - .025 * flex * Math.sin(Math.PI * x / (2 * width))
  const localZ = z + .16 * flex * Math.sin(Math.PI * x / width)
  return { x: localX * Math.cos(angle) + localZ * Math.sin(angle), z: -localX * Math.sin(angle) + localZ * Math.cos(angle) }
}
export function artworkRectangle(imageWidth: number, imageHeight: number, width: number, height: number, value: ArtworkFrame) {
  const f = normalizeArtworkFrame(value)
  const scale = (f.fit === "fit" ? Math.min(width / imageWidth, height / imageHeight) : Math.max(width / imageWidth, height / imageHeight)) * f.zoom
  const w = imageWidth * scale, h = imageHeight * scale
  return { x: (width - w) / 2 + f.x * Math.max(width, w) / 2, y: (height - h) / 2 + f.y * Math.max(height, h) / 2, width: w, height: h }
}

export function binderFill(slots: readonly number[], capacity: number) {
  if (capacity <= 0) return 0
  const represented = new Set(slots.filter(slot => Number.isInteger(slot) && slot >= 0 && slot < capacity))
  return Math.round(represented.size / capacity * 100)
}
