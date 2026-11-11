import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { chooseImage, crossCheckAtlas, imageCandidates, ledgerRow, matchRule, parseCsv, parseRules, parseSources, toCsv, type MirrorCardRow } from "../lib/card-assets/ledger"
import { pickCardImageUrl } from "../lib/card-image-sources"
import { buildTcgdexAssetImageUrl, pickImageLanguage } from "../lib/tcgdex-shared"

// Synthetic fixtures: ids, URLs and product numbers below are made up for these tests.
const sources = parseSources(readFileSync("card-assets/pokemon/tcg/sources.csv", "utf8"))
const rules = parseRules(readFileSync("card-assets/pokemon/tcg/rules.csv", "utf8"), sources)

function card(partial: Partial<MirrorCardRow>): MirrorCardRow {
  return { id: "test1-001", series_id: "test", set_id: "test1", local_id: "001", name_en: "Synthetic", image_languages_json: [], external_ids_json: {}, ...partial }
}

const POKEMONCOM = "https://assets.pokemon.com/static-assets/content-assets/cms2/img/cards/web/TST1/TST1_EN_1.png"

function appImage(row: MirrorCardRow) {
  const language = pickImageLanguage(row.image_languages_json, "en")
  return pickCardImageUrl(row.external_ids_json, language, language && buildTcgdexAssetImageUrl(language, row.series_id, row.set_id, row.local_id)) ?? ""
}

describe("card-assets csv", () => {
  test("round-trips quotes, commas and newlines", () => {
    const rows = [{ a: 'say "hi", twice', b: "line\nbreak" }, { a: "", b: "plain" }]
    assert.deepEqual(parseCsv(toCsv(["a", "b"], rows)), rows)
  })
})

describe("card-assets rules", () => {
  test("rejects unknown sources, forbidden sources and bad scopes", () => {
    assert.throws(() => parseRules("scope,lang,prefer\n*,en,nowhere\n", sources), /unknown source/)
    assert.throws(() => parseRules("scope,lang,prefer\n*,en,tcgcollector\n", sources), /forbidden/)
    assert.throws(() => parseRules("scope,lang,prefer\n*,en,paradijs\n", sources), /needed/)
    assert.throws(() => parseRules("scope,lang,prefer\nsets:x,en,tcgdex\n", sources), /scope/)
    assert.throws(() => parseRules("scope,lang,prefer\n*,en,tcgdex\n*,en,malie\n", sources), /duplicate/)
  })

  test("the most specific scope wins", () => {
    const scoped = parseRules([
      "scope,lang,prefer",
      "*,en,tcgdex",
      "series:tk,en,scrydex",
      "set:tk-*,en,limitless",
      "set:tk-xy-*,en,pokemontcg",
      "set:tk-xy-n,en,malie",
      "card:tk-xy-n-1,en,tcgplayer",
    ].join("\n"), sources)
    const pick = (id: string, set_id: string, series_id = "tk") => matchRule(scoped, { id, set_id, series_id }, "en")?.scope
    assert.equal(pick("tk-xy-n-1", "tk-xy-n"), "card:tk-xy-n-1")
    assert.equal(pick("tk-xy-n-2", "tk-xy-n"), "set:tk-xy-n")
    assert.equal(pick("tk-xy-b-1", "tk-xy-b"), "set:tk-xy-*")
    assert.equal(pick("tk-bw-z-1", "tk-bw-z"), "set:tk-*")
    assert.equal(pick("x-1", "x", "tk"), "series:tk")
    assert.equal(pick("sv01-001", "sv01", "sv"), "*")
    assert.equal(matchRule(scoped, { id: "a", set_id: "a", series_id: "a" }, "fr"), null)
  })
})

describe("card-assets default rule matches what the app serves", () => {
  const cases: Array<[string, MirrorCardRow, string]> = [
    ["reviewed catalog image wins", card({ image_languages_json: ["en"], external_ids_json: { catalog: { image: "https://product-images.tcgplayer.com/123456.jpg" }, pokemoncom: { image: POKEMONCOM } } }), "tcgplayer"],
    ["official pokemon.com beats an English TCGdex image", card({ image_languages_json: ["en"], external_ids_json: { pokemoncom: { image: POKEMONCOM } } }), "pokemoncom"],
    ["a foreign-only TCGdex print hides pokemon.com", card({ image_languages_json: ["it", "de"], external_ids_json: { pokemoncom: { image: POKEMONCOM } } }), "tcgdex"],
    ["no TCGdex image: pokemon.com before the recorded TCGdex image", card({ external_ids_json: { pokemoncom: { image: POKEMONCOM }, tcgdex: { image: "https://assets.tcgdex.net/en/test/test1/001" } } }), "pokemoncom"],
    ["pokemon_tcg fields can point at Scrydex", card({ external_ids_json: { pokemon_tcg: { imageLarge: "https://images.scrydex.com/pokemon/test1-1/large" } } }), "scrydex"],
    ["TCGplayer id from a variant", card({ external_ids_json: { tcgdex: { variantThirdParty: [{ tcgplayer: 654321 }] } } }), "tcgplayer"],
    ["nothing known", card({}), ""],
  ]
  for (const [name, row, source] of cases) {
    test(name, () => {
      const ledger = ledgerRow(row, rules, sources)
      assert.equal(ledger.source, source)
      assert.equal(ledger.url, appImage(row))
    })
  }

  test("alternatives list every other known image", () => {
    const row = card({ image_languages_json: ["it"], external_ids_json: { pokemoncom: { image: POKEMONCOM }, tcgdex: { thirdParty: { tcgplayer: "111" } } } })
    assert.equal(ledgerRow(row, rules, sources).alternatives, "pokemoncom tcgplayer")
    assert.equal(chooseImage(imageCandidates(row), ["pokemoncom"]), null, "an ineligible candidate is never chosen")
  })
})

describe("card-assets atlas cross-check", () => {
  test("flags unknown atlas ids and unexplained permission gaps", () => {
    const local = parseSources([
      "id,name,kind,permission,permission_note,hosts,max_size,credit,credit_url,atlas_id",
      "a,A,fan-scan,none,,,,,,scanner-site",
      "b,B,fan-scan,none,Martin said yes on 2026-11-11,,,,,scanner-site",
      "c,C,rehost,none,,,,,,missing",
    ].join("\n"))
    const result = crossCheckAtlas(local, { sources: [{ id: "scanner-site" }], gaps: [{ lang: "en", fills: [{ source: "scanner-site", permission: "scanner" }] }] })
    assert.deepEqual(result.errors, ['c: atlas_id "missing" is not in the atlas'])
    assert.equal(result.warnings.length, 1)
    assert.match(result.warnings[0], /^a: /)
  })

  test("every atlas id in sources.csv exists in the pinned atlas", () => {
    const atlas = JSON.parse(readFileSync("card-assets/pokemon/tcg/atlas/data.json", "utf8"))
    assert.deepEqual(crossCheckAtlas(sources, atlas).errors, [])
  })
})
