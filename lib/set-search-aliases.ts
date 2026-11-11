/**
 * Printed set codes (bottom-left of the card) → mirror set ids. Only codes printed on the cards; DLR verified
 * against TCGplayer group 24831 (ME06: Delta Reign), PBL from the TCGdex abbreviation on me05.
 */
const PRINTED_SET_CODES: Record<string, string> = {
  ssh: "swsh1", rcl: "swsh2", daa: "swsh3", cpa: "swsh3.5", viv: "swsh4", shf: "swsh4.5", bst: "swsh5", cre: "swsh6",
  evs: "swsh7", cel: "cel25", fst: "swsh8", brs: "swsh9", asr: "swsh10", pgo: "swsh10.5", lor: "swsh11", sit: "swsh12", crz: "swsh12.5",
  svi: "sv01", pal: "sv02", obf: "sv03", mew: "sv03.5", par: "sv04", paf: "sv04.5", tef: "sv05", twm: "sv06", sfa: "sv06.5",
  scr: "sv07", ssp: "sv08", pre: "sv08.5", jtg: "sv09", dri: "sv10", blk: "sv10.5b", wht: "sv10.5w",
  meg: "me01", pfl: "me02", pbl: "me05", dlr: "me06",
}

/** The mirror set id for a printed code ("MEW" → "sv03.5"); anything else comes back trimmed and lowercased. */
export function resolveSetSearchAlias(query: string) {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase()
  return PRINTED_SET_CODES[normalized] ?? normalized
}
