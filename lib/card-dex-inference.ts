import catalog from "./pokemon-catalog.json"

type CatalogEntry = { id: number; name: string }

function normalizeKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
}

/** Normalized species name (and unambiguous base name for form entries like "deoxys-normal") -> dex id. */
export function buildDexNameIndex(entries: CatalogEntry[] = catalog as CatalogEntry[]) {
  const index = new Map<string, number>()
  const baseCounts = new Map<string, number>()

  for (const entry of entries) {
    index.set(normalizeKey(entry.name), entry.id)
    if (entry.name.includes("-")) {
      const base = normalizeKey(entry.name.split("-")[0])
      baseCounts.set(base, (baseCounts.get(base) ?? 0) + 1)
    }
  }

  for (const entry of entries) {
    if (!entry.name.includes("-")) continue
    const base = normalizeKey(entry.name.split("-")[0])
    if (baseCounts.get(base) === 1 && !index.has(base)) {
      index.set(base, entry.id)
    }
  }

  return index
}

let defaultIndex: Map<string, number> | null = null

/**
 * Best-effort National Dex ids for a Pokémon card whose source data has no `dexId`
 * (e.g. TCGdex's 30th Classic Collection reprints). Handles tag teams ("Pikachu & Zekrom GX"),
 * owners ("Erika's Jigglypuff"), prefixes ("Dark Tyranitar", "M Gardevoir EX", "Shining Celebi")
 * and suffixes ("Mew VMAX", "Greninja BREAK") by matching the longest run of words that is a species name.
 */
export function inferDexIdsFromCardName(cardName: string | null | undefined, index?: Map<string, number>) {
  if (!cardName) return []
  const lookup = index ?? (defaultIndex ??= buildDexNameIndex())
  const ids: number[] = []

  for (const part of cardName.split(/\s*&\s*/)) {
    const words = part
      .split(/\s+/)
      .filter(Boolean)
    let matched: number | undefined

    for (let size = words.length; size >= 1 && matched === undefined; size -= 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const window = words.slice(start, start + size)
        if (size === 1 && /['’]s$/i.test(window[0])) continue
        const id = lookup.get(normalizeKey(window.join(" ")))
        if (id !== undefined) {
          matched = id
          break
        }
      }
    }

    if (matched !== undefined && !ids.includes(matched)) {
      ids.push(matched)
    }
  }

  return ids
}
