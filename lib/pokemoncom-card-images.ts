/**
 * Official card scans on pokemon.com's asset CDN, addressed by set code and collector number:
 *   https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/BW10/BW10_EN_8.png
 *
 * Set codes are our TCGdex set ids upper-cased, with these exceptions (checked against the CDN):
 * - Scarlet & Violet / Crown Zenith half sets use "PT5" (sv03.5 → SV3PT5, swsh12.5 → SWSH12PT5); older ones drop the dot
 *   (sm3.5 → SM35, swsh4.5 → SWSH45).
 * - Subsets TCGdex splits out live in their parent set (swsh9tg → SWSH9, swsh4.5sv → SWSH45), except the Galarian Gallery.
 * Numbers lose leading zeros (001 → 1); prefixed numbers are kept (TG01, SV001, SWSH001).
 * Sets the CDN doesn't have simply 404; the mirror script reports them.
 */
export const POKEMONCOM_CARD_IMAGE_BASE = "https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web"

const SET_CODE_OVERRIDES: Readonly<Record<string, string>> = {
  "swsh4.5sv": "SWSH45",
  "swsh9tg": "SWSH9",
  "swsh10tg": "SWSH10",
  "swsh11tg": "SWSH11",
  "swsh12tg": "SWSH12",
  "swsh12.5gg": "SWSH12PT5GG",
}

export function pokemonComSetCode(setId: string) {
  const override = SET_CODE_OVERRIDES[setId]
  if (override) return override
  const upper = setId.toUpperCase()
  const halfSet = /^(SV\d+|SWSH12)\.5$/.exec(upper)
  const code = halfSet ? `${halfSet[1].replace(/^SV0/, "SV")}PT5` : upper.replace(/\./g, "")
  return /^[A-Z0-9]{1,16}$/.test(code) ? code : null
}

export function pokemonComCardNumber(localId: string) {
  if (/^\d{1,6}$/.test(localId)) return String(Number(localId))
  return /^[A-Z]{1,6}\d{1,6}$/i.test(localId) ? localId.toUpperCase() : null
}

/** pokemon.com image URL for one of our cards, or null when the id can't be expressed on the CDN. */
export function pokemonComCardImageUrl(setId: string, localId: string) {
  const code = pokemonComSetCode(setId)
  const number = pokemonComCardNumber(localId)
  return code && number ? `${POKEMONCOM_CARD_IMAGE_BASE}/${code}/${code}_EN_${number}.png` : null
}
