/**
 * Black Star promos sold alongside each set: Build & Battle / prerelease, single and three pack blisters,
 * Elite Trainer Box, and collections or tins named after the set. Researched from Bulbapedia's
 * SVP and MEP Black Star Promos lists (November 2026). Promos tied to other products (ex boxes,
 * battle decks, events) aren't listed, since they don't belong to one set.
 */
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i).padStart(3, "0"))
const sv = (...ids: string[][]) => ({ setId: "svp", localIds: ids.flat() })
const me = (...ids: string[][]) => ({ setId: "mep", localIds: ids.flat() })

const SET_PROMOS: Record<string, { setId: string; localIds: string[] }> = {
  "sv01": sv(range(5, 14)),
  "sv02": sv(range(19, 27)),
  "sv03": sv(range(36, 44)),
  "sv03.5": sv(range(46, 53)),
  "sv04": sv(range(57, 66)),
  "sv04.5": sv(range(69, 84)),
  "sv05": sv(range(89, 98)),
  "sv06": sv(range(114, 123)),
  "sv06.5": sv(range(129, 132), ["149"]),
  "sv07": sv(range(133, 141)),
  "sv08": sv(range(151, 159)),
  "sv08.5": sv(range(167, 176)),
  "sv09": sv(range(181, 189)),
  "sv10": sv(range(199, 203)),
  "sv10.5b": sv(["209", "212"]),
  "sv10.5w": sv(["210", "211"]),
  "me01": me(range(1, 10)),
  "me02": me(range(14, 22)),
  "me02.5": me(range(31, 36)),
  "me03": me(range(64, 70)),
  "me04": me(range(74, 80)),
  "me05": me(range(82, 88)),
  "30th": me(range(94, 101), range(104, 110)),
  "me06": me(range(111, 117)),
}

/** The promo set and card numbers commonly collected with `setId`, or null when none are known. */
export function knownSetPromos(setId: string) {
  return SET_PROMOS[setId] ?? null
}
