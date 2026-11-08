// TCGdex 30th-c uses catalog positions, not the original numbers retained on the reprints.
// Verified 2026-11-08 by joining variants_detailed.thirdParty.tcgplayer to
// https://tcgcsv.com/tcgplayer/3/24837/products (extendedData.Number).
const PRINTED_NUMBERS: Record<string, string> = {
  "30th-c-001": "4/102", // Charizard, product 714372
  "30th-c-002": "5/109", // Delcatty, product 716156
  "30th-c-003": "11/113", // Metagross, product 716157
  "30th-c-004": "11/101", // Genesect EX, product 716158
  "30th-c-005": "18/132", // Misty, product 716159
  "30th-c-006": "19/109", // Dark Tyranitar, product 716160
  "30th-c-007": "25/111", // Sneasel, product 716161
  "30th-c-008": "33/181", // Pikachu & Zekrom GX, product 714373
  "30th-c-009": "41/122", // Greninja BREAK, product 716162
  "30th-c-010": "43/146", // Uxie, product 716163
  "30th-c-011": "47/127", // Crobat G, product 716191
  "30th-c-012": "050/185", // Raikou, product 716192
  "30th-c-013": "57/111", // Buzzwole GX, product 716193
  "30th-c-014": "58/102", // Pikachu, product 716194
  "30th-c-015": "69/132", // Erika's Jigglypuff, product 716195
  "30th-c-016": "85/124", // Rayquaza EX, product 716196
  "30th-c-017": "89/149", // Solgaleo GX, product 716197
  "30th-c-018": "94/102", // Gengar, product 716198
  "30th-c-019": "99/102", // Darkrai & Cresselia LEGEND, product 716199
  "30th-c-020": "100/102", // Darkrai & Cresselia LEGEND, product 716200
  "30th-c-021": "101/101", // N, product 716202
  "30th-c-022": "106/106", // Palkia, product 716203
  "30th-c-023": "106/160", // M Gardevoir EX, product 716204
  "30th-c-024": "106/105", // Shining Celebi, product 716205
  "30th-c-025": "108/115", // Scizor ex, product 716206
  "30th-c-026": "114/264", // Mew VMAX, product 716207
  "30th-c-027": "123/172", // Arceus VSTAR, product 716208
  "30th-c-028": "138/202", // Zacian V, product 716209
  "30th-c-029": "149/147", // Lugia, product 714386
  "30th-c-030": "203/193", // Magikarp, product 716210
}

export function getClassicCollectionPrinting(cardId: string) {
  const number = PRINTED_NUMBERS[cardId]
  if (typeof number !== "string") return null
  const [localId, total] = number.split("/")
  return {
    number,
    localId,
    officialCardCount: Number(total),
    setName: "30th Classic Collection",
    setAliases: ["30th Celebration Classic Collection", "30th Celebrations Classic Collection", "30th Anniversary Classic Collection"],
  }
}
