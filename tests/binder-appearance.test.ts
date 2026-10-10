import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { binderArtworkIds, binderArtworkPath, isBinderUploadId, parseBinderAppearance } from "../lib/binder-appearance"
import { defaultBinderDesign } from "../lib/binder-design"
import { AppearanceError, requireAppearanceOrigin, writeAppearance, checkAppearanceDatabaseError, loadBinderArtwork, requireExpectedAppearanceOwner } from "../lib/server/binder-appearance"
import type { createAdminClient } from "../lib/supabase/admin"

const upload = "upload:9ade73fb-d75e-4174-86a1-9e4769b85f30"
test("appearance writes reject missing revision, malformed surfaces and unsafe artwork", () => {
  const design = defaultBinderDesign()
  assert.deepEqual(parseBinderAppearance({ design, baseRevision: 0 }), { design, baseRevision: 0 })
  for (const baseRevision of [-1, 1.5, "0", undefined, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parseBinderAppearance({ design, baseRevision }), /revision/)
  assert.throws(() => parseBinderAppearance({ design: {}, baseRevision: 0 }), /design/)
  for (const artwork of ["upload:missing", "blob:bad", "/api/binder-appearance/artwork?id=other", "https://evil.example/x"]) {
    const invalid = structuredClone(design); invalid.surfaces.cover.artwork = artwork
    assert.throws(() => parseBinderAppearance({ design: invalid, baseRevision: 0 }), /artwork/)
  }
})
test("artwork paths are owner scoped and unique references are retained", () => {
  assert.equal(isBinderUploadId(upload), true)
  assert.equal(isBinderUploadId("upload:../someone"), false)
  assert.equal(binderArtworkPath("owner", upload), `owner/${upload.slice(7)}`)
  assert.throws(() => binderArtworkPath("owner", "upload:../someone"))
  const design = defaultBinderDesign(); design.surfaces.cover.artwork = upload; design.surfaces.back.artwork = upload
  assert.deepEqual(binderArtworkIds(design), [upload])
})
test("cross-site writes are rejected and missing migration reports unavailable", () => {
  requireAppearanceOrigin(new Request("https://binder.example/api/binder-appearance", { headers: { Origin: "https://binder.example" } }))
  assert.throws(() => requireAppearanceOrigin(new Request("https://binder.example/api/binder-appearance", { headers: { Origin: "https://evil.example" } })), (error: unknown) => error instanceof AppearanceError && error.status === 403)
  assert.throws(() => checkAppearanceDatabaseError({ code: "42P01" }), (error: unknown) => error instanceof AppearanceError && error.status === 503)
})
test("appearance requests must match the owner derived from the current session", () => {
  const endpoint = "https://binder.example/api/binder-appearance"
  requireExpectedAppearanceOwner(new Request(endpoint, { headers: { "X-Binder-Owner": "owner" } }), "owner")
  for (const request of [new Request(endpoint), new Request(endpoint, { headers: { "X-Binder-Owner": "previous-owner" } })]) {
    assert.throws(() => requireExpectedAppearanceOwner(request, "owner"), (error: unknown) => error instanceof AppearanceError && error.status === 403)
  }
})
test("CAS updates require the supplied revision and first writes cannot replace another device", async () => {
  const calls: unknown[][] = []
  const query = {
    upsert(...args: unknown[]) { calls.push(["upsert", ...args]); return this },
    update(...args: unknown[]) { calls.push(["update", ...args]); return this },
    eq(...args: unknown[]) { calls.push(["eq", ...args]); return this },
    select() { return this },
    async maybeSingle() { return { data: null, error: null } },
  }
  const admin = { from: () => query } as unknown as ReturnType<typeof createAdminClient>
  assert.equal(await writeAppearance(admin, "owner", defaultBinderDesign(), 3), null)
  assert.ok(calls.some(call => call[0] === "eq" && call[1] === "revision" && call[2] === 3))
  calls.length = 0
  assert.equal(await writeAppearance(admin, "owner", defaultBinderDesign(), 0), null)
  assert.deepEqual(calls[0][2], { onConflict: "owner_user_id", ignoreDuplicates: true })
})
test("migration protects artwork and prevents direct writes bypassing validation", () => {
  const sql = readFileSync(new URL("../scripts/024_binder_appearances.sql", import.meta.url), "utf8")
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
  assert.match(sql, /REVOKE ALL ON public.binder_appearances FROM anon, authenticated/)
  assert.match(sql, /AS RESTRICTIVE FOR ALL TO anon, authenticated/)
  assert.match(sql, /false, 5242880/)
  assert.match(sql, /partnerships.owner_user_id = binder_appearances.owner_user_id/)
})
test("uploaded bytes are validated instead of trusting the declared image MIME", async () => {
  let blob = new Blob(["Synthetic invalid artwork"], { type: "image/png" })
  const admin = { storage: { from: () => ({ download: async () => ({ data: blob, error: null }) }) } } as unknown as ReturnType<typeof createAdminClient>
  await assert.rejects(loadBinderArtwork(admin, "owner", upload), /could not be opened/)
  const { default: sharp } = await import("sharp")
  const synthetic = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#fff" } }).png().toBuffer()
  blob = new Blob([new Uint8Array(synthetic)], { type: "image/jpeg" })
  const validated = await loadBinderArtwork(admin, "owner", upload)
  assert.equal(validated.contentType, "image/png")
  assert.deepEqual(validated.bytes, synthetic)
})
