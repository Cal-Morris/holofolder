import { DESIGN_SURFACES, type ArtworkFrame, type BinderDesign } from "@/lib/binder-design"
import { FEATURED_CARDS, getFeaturedCardImageUrl } from "@/lib/featured-cards"

interface PresetAppearance {
  id: string
  name: string
  colors: [string, string, string, string, string]
  material: BinderDesign["material"]
  font: BinderDesign["font"]
  ink: string
  textSize: number
  zip: BinderDesign["zip"]
  artwork?: { url: string; frame: ArtworkFrame }
}

const magikarp = FEATURED_CARDS.find((card) => card.id === "sv02-203")!
const mew = FEATURED_CARDS.find((card) => card.id === "sv03.5-193")!
const appearances: readonly PresetAppearance[] = [
  {
    id: "archive", name: "Archive", colors: ["#262729", "#212224", "#292a2d", "#353538", "#232529"],
    material: "pebbled", font: "monospace", ink: "#ede8de", textSize: 52,
    zip: { teeth: "#797d82", tape: "#222326", pull: "#b7bdc3", type: "nylon" },
  },
  {
    id: "ivory", name: "Ivory", colors: ["#e8e3d8", "#ddd7cb", "#ded8cb", "#d4cdc0", "#c4c0b4"],
    material: "smooth", font: "serif", ink: "#3b342c", textSize: 64,
    zip: { teeth: "#9b9281", tape: "#bcb4a6", pull: "#b0a18b", type: "metal" },
  },
  {
    id: "midnight", name: "Midnight", colors: ["#263244", "#1e2938", "#223043", "#334052", "#253242"],
    material: "smooth", font: "sans-serif", ink: "#d9d9d4", textSize: 60,
    zip: { teeth: "#637385", tape: "#1d2734", pull: "#b7c2cf", type: "nylon" },
  },
  {
    id: "oxblood", name: "Oxblood", colors: ["#5b2930", "#48232a", "#57252d", "#6c343a", "#352b2e"],
    material: "pebbled", font: "serif", ink: "#ead9c6", textSize: 64,
    zip: { teeth: "#bca589", tape: "#442128", pull: "#d9bea0", type: "metal" },
  },
  {
    id: "magikarp", name: "Magikarp", colors: ["#25323c", "#19232d", "#253544", "#202932", "#1c2631"],
    material: "smooth", font: "sans-serif", ink: "#eadab7", textSize: 56,
    zip: { teeth: "#c8b28b", tape: "#15232d", pull: "#d9bf8c", type: "metal" },
    artwork: { url: getFeaturedCardImageUrl(magikarp), frame: { fit: "fill", zoom: 1.62, x: .02, y: .25 } },
  },
  {
    id: "mew", name: "Mew", colors: ["#dbadb9", "#d4b9c3", "#cca5b6", "#ead9e0", "#d4c0cd"],
    material: "smooth", font: "serif", ink: "#442d42", textSize: 60,
    zip: { teeth: "#b9b7c1", tape: "#b98b9e", pull: "#d6d2da", type: "metal" },
    artwork: { url: getFeaturedCardImageUrl(mew), frame: { fit: "fill", zoom: 2.5, x: .1, y: .39 } },
  },
]

export const BINDER_DESIGN_PRESETS: readonly { id: string; name: string; swatches: readonly string[] }[] = appearances.map(({ id, name, colors, zip }) => ({
  id, name, swatches: [colors[0], colors[3], zip.pull],
}))

export function applyBinderDesignPreset(current: BinderDesign, id: string): BinderDesign {
  const preset = appearances.find((appearance) => appearance.id === id)
  if (!preset) return current
  const surfaces = { ...current.surfaces }
  for (const [index, surface] of DESIGN_SURFACES.entries()) {
    const artwork = surface === "cover" ? preset.artwork : undefined
    surfaces[surface] = {
      ...current.surfaces[surface],
      color: preset.colors[index],
      artwork: artwork?.url ?? null,
      frame: artwork ? { ...artwork.frame } : { fit: "fill", zoom: 1, x: 0, y: 0 },
    }
  }
  return {
    ...current, surfaces, material: preset.material, font: preset.font, ink: preset.ink, textSize: preset.textSize,
    pageColor: preset.colors[4], pageColors: { ...current.pageColors }, zip: { ...preset.zip },
  }
}
