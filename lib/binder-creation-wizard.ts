export type CreationPreset = "set" | "blank" | "national" | "generation" | "species" | "printings"
export interface PageSize { rows: number; cols: number }

/** Page sizes every plan can use (the same set the saved-layout rule allows without Premium). */
export const FREE_PAGE_SIZES: readonly PageSize[] = [{ rows: 2, cols: 2 }, { rows: 3, cols: 3 }, { rows: 3, cols: 4 }, { rows: 4, cols: 4 }]

export function pageSizeLabel(size: PageSize): string {
  return `${size.rows * size.cols} pockets, ${size.rows} by ${size.cols}`
}

/** A starting name the person can keep or change. A blank or hand-picked binder has no obvious name. */
export function suggestedBinderName(preset: CreationPreset, context: { region?: string; setName?: string } = {}): string {
  if (preset === "national") return "National Dex"
  if (preset === "generation") return context.region ?? ""
  if (preset === "set") return context.setName ?? ""
  return ""
}

const count = (value: number, one: string, many = `${one}s`) => `${value.toLocaleString("en-GB")} ${value === 1 ? one : many}`

/** One line under the name in the preview: what the binder holds and how many pages that makes. */
export function creationSummary(preset: CreationPreset, entries: number, grid: PageSize | null, context: { region?: string; setName?: string } = {}): string {
  const what = preset === "national" ? `National Dex · ${count(entries, "Pokémon", "Pokémon")}`
    : preset === "generation" ? `${context.region ?? "Generation"} · ${count(entries, "Pokémon", "Pokémon")}`
    : preset === "species" ? count(entries, "Pokémon", "Pokémon")
    : preset === "set" ? `${context.setName ?? "Set"} · ${count(entries, "card")}`
    : preset === "printings" ? count(entries, "card") : "Blank"
  if (!grid) return `${what} · list`
  if (!entries) return `${what} · ${grid.rows * grid.cols} pockets a page`
  return `${what} · ${count(Math.ceil(entries / (grid.rows * grid.cols)), "page")} of ${grid.rows * grid.cols}`
}
