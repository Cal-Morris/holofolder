import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createBinderBackup, binderBackupFilename, type BinderBackupInput } from "@/lib/binder-backup"
import { defaultBinderDesign } from "@/lib/binder-design"
import { getDefaultBinderSettings } from "@/lib/settings"

// Synthetic collection and artwork, no real account data.
function fixture(): BinderBackupInput {
  return {
    binderId: "binder-a",
    binder: { id: "binder-a", ownerUserId: "private-owner", name: "Trades", color: "#123456", rows: 3, cols: 3, isDefault: false, sortOrder: 1, createdAt: null, updatedAt: null },
    collection: [{ id: "slot-a", pokemon_id: 4, pokemon_name: "charmander", card_id: "synthetic-4", card_name: "Charmander", card_image: "https://example.test/card.webp", card_set: "Synthetic set", card_language: "ja", card_finish: "reverse_holo", status: "finalized", collected_at: "2026-01-01T00:00:00.000Z", wanted_cards: [{ card_id: "synthetic-5", card_name: "Charmander", card_image: "https://example.test/wanted.webp", card_set: "Synthetic wanted set", card_language: "de", card_finish: "holo", rarity: "Rare", local_id: "5", set_total: 100, illustrator: "Synthetic artist", added_at: "2026-02-01T00:00:00.000Z" }] }],
    settings: { ...getDefaultBinderSettings(), binderRows: 3, binderCols: 3, binderPageColors: { "2": "ruby" }, preferredCurrency: "EUR", preferredCardLanguage: "ja" },
    design: defaultBinderDesign(), uploads: {},
  }
}

const date = new Date("2026-11-06T12:34:56.000Z")
describe("binder backup", () => {
  test("JSON round trip keeps owned and wanted metadata, status, settings and design", async () => {
    const input = fixture()
    input.design.surfaces.cover.words = "My trades"
    const backup = JSON.parse(JSON.stringify(await createBinderBackup(input, date)))
    assert.equal(backup.format, "binderdex-binder-backup")
    assert.equal(backup.version, 1)
    assert.equal(backup.exportedAt, date.toISOString())
    assert.equal(backup.scope, "current-binder")
    assert.deepEqual(backup.collection, input.collection)
    assert.deepEqual(backup.settings, input.settings)
    assert.deepEqual(backup.design, input.design)
    assert.equal(backup.binder.name, "Trades")
    assert.equal(backup.binder.id, "binder-a")
  })
  test("allowlists data and only embeds artwork referenced by this design", async () => {
    const input = fixture()
    Object.assign(input.collection[0], { access_token: "secret", user_id: "private-owner", binder_id: "binder-a" })
    Object.assign(input.settings, { refresh_token: "secret" })
    Object.assign(input.design, { session: "secret" })
    input.design.surfaces.cover.artwork = "upload:cover"
    input.design.surfaces.back.artwork = "upload:missing"
    input.uploads = { "upload:cover": new Blob(["synthetic-image"], { type: "image/png" }), "upload:other": new Blob(["private-other-binder"]) }
    const backup = await createBinderBackup(input, date)
    assert.deepEqual(backup.artwork, { "upload:cover": { mimeType: "image/png", base64: btoa("synthetic-image") } })
    assert.deepEqual(backup.missingArtwork, ["upload:missing"])
    assert.doesNotMatch(JSON.stringify(backup), /secret|private-owner|private-other-binder|user_id|access_token|refresh_token/)
  })
  test("snapshots current optimistic state without mutating it or waiting for artwork", async () => {
    const input = fixture()
    input.collection[0].card_finish = "holo"
    input.design.surfaces.cover.artwork = "upload:cover"
    input.uploads["upload:cover"] = new Blob(["synthetic"])
    const pending = createBinderBackup(input, date)
    input.collection[0].card_finish = "normal"
    input.settings.binderPageColors["2"] = "ocean"
    const backup = await pending
    assert.equal(backup.collection[0].card_finish, "holo")
    assert.equal(backup.settings.binderPageColors["2"], "ruby")
    assert.equal(input.collection[0].card_finish, "normal")
  })
  test("rejects mismatched binder identity and unsupported card values", async () => {
    const input = fixture()
    input.binderId = "binder-b"
    await assert.rejects(createBinderBackup(input), /binder changed/)
    input.binderId = "binder-a"
    Object.assign(input.collection[0], { card_finish: "future-finish" })
    await assert.rejects(createBinderBackup(input), /unsupported card data/)
  })
  test("local and empty binders have explicit unknown identity, no invented name", async () => {
    const input = fixture()
    input.binderId = null
    input.binder = null
    input.collection = []
    const backup = await createBinderBackup(input, date)
    assert.equal(backup.binder.id, null)
    assert.equal(backup.binder.name, null)
    assert.deepEqual(backup.collection, [])
  })
  test("filenames are readable, dated and safe even for unusual binder names", () => {
    assert.equal(binderBackupFilename("Cal’s Pokémon / Trades", date.toISOString()), "binderdex-cal-s-pokemon-trades-2026-11-06T12-34-56-000Z.json")
    assert.equal(binderBackupFilename("../../💚", date.toISOString()), "binderdex-binder-2026-11-06T12-34-56-000Z.json")
    assert.ok(binderBackupFilename("x".repeat(200), date.toISOString()).length < 110)
  })
})
