/**
 * Small TCGdex helpers shared by the card DB sync (lib/card-db-sync.ts), the read side (lib/tcg-mirror.ts)
 * and the Blob image mirror (lib/card-image-blob.ts). Keep this module free of Node, Supabase and Blob
 * imports so any of those can use it without pulling in each other's dependencies.
 */

export const TCGDEX_ASSET_HOST = "assets.tcgdex.net"

/** Language order used when a localized TCGdex value has no entry for the requested language. */
export const TCGDEX_LANGUAGE_FALLBACKS = ["en", "ja", "fr", "de", "es", "it", "pt-br", "ko"] as const

/** Picks the requested language from a TCGdex localized value, then the fallbacks, then any non-empty string. */
export function pickLocalizedText(value: unknown, language = "en"): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value !== "object" || Array.isArray(value)) return null

  const candidateMap = value as Record<string, unknown>
  for (const key of [language, ...TCGDEX_LANGUAGE_FALLBACKS]) {
    const candidate = candidateMap[key]
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  for (const candidate of Object.values(candidateMap)) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate
    }
  }

  return null
}

/** `https://assets.tcgdex.net/<lang>/<series>/<set>/<localId>/<quality>.<ext>` with each segment URL-encoded. */
export function buildTcgdexAssetImageUrl(
  language: string,
  seriesId: string,
  setId: string,
  localId: string,
  quality: "high" | "low" = "high",
  extension: "webp" | "png" | "jpg" = "webp",
) {
  return `https://${TCGDEX_ASSET_HOST}/${[language, seriesId, setId, localId].map(encodeURIComponent).join("/")}/${quality}.${extension}`
}

/** The `tcgdex.image` value stored in `tcg_cards.external_ids_json`, if any. */
export function pickTcgdexImageFromExternalIds(externalIds: unknown): string | null {
  if (!externalIds || typeof externalIds !== "object" || Array.isArray(externalIds)) return null
  const tcgdex = (externalIds as Record<string, unknown>).tcgdex
  if (!tcgdex || typeof tcgdex !== "object" || Array.isArray(tcgdex)) return null
  const image = (tcgdex as Record<string, unknown>).image
  return typeof image === "string" && image.length > 0 ? image : null
}
