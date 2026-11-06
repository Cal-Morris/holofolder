import { test } from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { Client } from "pg"
import { upsertRestSetPayload, type MirrorCardRow } from "../lib/card-db-sync"

const databaseUrl = process.env.CATALOG_TEST_DATABASE_URL
test("additive sync retains saved IDs, supplemental metadata and source links across repeat imports", { skip: !databaseUrl }, async () => {
  if (!databaseUrl) return
  if (!["localhost", "127.0.0.1"].includes(new URL(databaseUrl).hostname)) throw new Error("Catalog integration tests require an isolated local database")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    await client.query(await readFile(new URL("../scripts/004_create_tcg_mirror_tables.sql", import.meta.url), "utf8"))
    await client.query("BEGIN")
    const card: MirrorCardRow = { id: "saved-card", set_id: "test-set", series_id: "test-series", local_id: "1", local_id_sort: 1, name_en: "Bulbasaur", name_json: { en: "Bulbasaur" }, category: "Pokemon", rarity: null, hp: 60, illustrator: null, types_json: [], image_languages_json: [], variants_json: {}, external_ids_json: { catalog: { image: "https://product-images.tcgplayer.com/1.jpg" } }, raw_json: {} }
    const series = [{ id: "test-series", name_json: { en: "Test" }, name_en: "Test", raw_json: {} }]
    const sets = [{ id: "test-set", series_id: "test-series", name_json: { en: "Test" }, name_en: "Test", official_card_count: 1, release_date: null, raw_json: {} }]
    await upsertRestSetPayload(client, { series, sets, cards: [card], dexLinks: [{ card_id: card.id, dex_id: 1 }], externalSources: [{ card_id: card.id, source: "tcgcsv", source_card_id: "1", source_set_id: null, raw_json: {} }] }, () => {}, false)
    await client.query("create temporary table saved_binder (card_id text); insert into saved_binder values ('saved-card')")
    const incoming = { ...card, id: "renamed-by-source", external_ids_json: {}, name_en: "Updated Bulbasaur" }
    for (let i = 0; i < 2; i++) {
      await upsertRestSetPayload(client, { series, sets, cards: [incoming], dexLinks: [{ card_id: incoming.id, dex_id: 1 }], externalSources: [] }, () => {}, false)
    }
    const rows = (await client.query("select c.* from public.tcg_cards c join saved_binder b on b.card_id=c.id")).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].id, "saved-card")
    assert.equal(rows[0].name_en, "Updated Bulbasaur")
    assert.equal(rows[0].external_ids_json.catalog.image, "https://product-images.tcgplayer.com/1.jpg")
    assert.equal((await client.query("select count(*)::int as n from public.tcg_card_external_sources where card_id='saved-card'")).rows[0].n, 1)
    assert.equal((await client.query("select count(*)::int as n from public.tcg_card_dex_ids where card_id='saved-card'")).rows[0].n, 1)
    assert.equal((await client.query("select count(*)::int as n from public.tcg_cards where set_id='test-set'")).rows[0].n, 1)
  } finally { await client.query("ROLLBACK"); await client.end() }
})
