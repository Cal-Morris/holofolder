import assert from "node:assert/strict"
async function main() {
// @ts-expect-error Bun module mocks stay in this isolated subprocess.
const { mock } = await import("bun:test")
mock.module("server-only", () => ({}))
const { storageCommandHarness } = await import("./storage-command-harness")
const { handleStorageCommand } = await import("../../lib/server/storage-command-http")
const { handleInventoryCompleteRead } = await import("../../lib/server/inventory-read-http")
const { client } = storageCommandHarness("synthetic-http-proof")
const owner = "00000000-0000-4000-8000-0000000000e2"
const command = { collectionId: "22222222-2222-4222-8222-222222222222", operationId: "synthetic-http-command", inventoryRevision: 7, collectionVersion: 3, layoutRevision: 4,
  commands: [{ kind: "create", ids: ["inserted-slot"], beforeSlotId: null }] }
const request = (headers = {}, body = command) => new Request("http://localhost:3529/app/e2e-harness/storage/slots", { method: "POST", headers: {
  origin: "http://localhost:3529", "content-type": "application/json", "X-Binder-Owner": owner,
  "X-Binder-Auth-Session": "synthetic-e2e-auth-session", "X-Storage-Operation": command.operationId, ...headers }, body: JSON.stringify(body) })
for (const [headers, status] of [[{ origin: "https://attacker.test" }, 403], [{ origin: "" }, 403], [{ "X-Binder-Owner": "another-owner" }, 403], [{ "X-Binder-Auth-Session": "obsolete-session" }, 403], [{ "X-Storage-Operation": "another-command" }, 400]] as const) {
  const response = await handleStorageCommand(request(headers), "slots", { session: client, admin: client })
  assert.equal(response.status, status, await response.text())
}
const response = await handleStorageCommand(request(), "slots", { session: client, admin: client })
assert.equal(response.status, 200, await response.clone().text())
const body = await response.json()
assert.equal(body.operationId, command.operationId); assert.equal(body.receipt.inventoryRevision, 8); assert.equal("snapshot" in body, false)
const replay = await handleStorageCommand(request(), "slots", { session: client, admin: client })
assert.deepEqual(await replay.json(), body)
const staleId = "synthetic-http-terminal-rejection"
const stale = request({ "X-Storage-Operation": staleId }, { ...command, operationId: staleId })
const rejection = await handleStorageCommand(stale, "slots", { session: client, admin: client })
assert.equal(rejection.status, 409)
assert.equal(rejection.headers.get("cache-control"), "private, no-store")
assert.deepEqual(await rejection.json(), { version: 1, operationId: staleId, rejection: {
  outcome: "rejected", operationId: staleId, code: "slot_revision_conflict", inventoryRevision: 8,
} })
const proxied = request()
const proxyHeaders = new Headers(proxied.headers); proxyHeaders.set("origin", "https://holofolder.com")
const proxyReply = await handleStorageCommand(new Request("https://app.holofolder.com/app/api/binder-slots", {
  method: "POST", headers: proxyHeaders, body: await proxied.text(),
}), "slots", { session: client, admin: client })
assert.equal(proxyReply.status, 200, await proxyReply.clone().text())
assert.deepEqual(await proxyReply.json(), body)
const fresh = await handleInventoryCompleteRead(new Request("http://localhost:3529/app/e2e-harness/storage/inventory?requestId=fresh&sessionId=epoch"), client)
assert.equal(fresh.status, 200)
const snapshot = await fresh.json(); assert.equal(snapshot.snapshot.binders[0].slots.length, 5)
assert.equal(snapshot.evidence.slots, 5)
for (const extra of [{ actor: owner }, { source: "app" }, { context: {} }, { version: 99 }]) {
  const bad = await handleStorageCommand(request({}, { ...command, ...extra }), "slots", { session: client, admin: client })
  assert.equal(bad.status, 400)
}

// Creation reuses 093 authoritative errors, including original historical replay after later edits.
const creation = { version: 1, operationId: "synthetic-http-creation", inventoryRevision: 7,
  collectionId: "33333333-3333-4333-8333-333333333333", name: "Synthetic", kind: "binder", defaultPresentation: "binder", grid: null, location: null,
  manifest: { version: 1, presetId: "blank", presetVersion: 1, name: "Blank", entries: [] }, slotIds: [] }
const createRequest = () => new Request("http://localhost:3529/app/e2e-harness/storage/creation", { method: "POST", headers: {
  origin: "http://localhost:3529", "content-type": "application/json", "X-Binder-Owner": owner, "X-Binder-Actor": owner,
  "X-Binder-Auth-Session": "synthetic-e2e-auth-session", "X-Storage-Operation": creation.operationId, "X-Storage-Delivery": "synthetic-delivery" }, body: JSON.stringify(creation) })
const { blankPreset } = await import("../../lib/binder-creation-draft")
Object.assign(creation, { manifest: blankPreset() })
const creationReply = await handleStorageCommand(createRequest(), "collection.create", { session: client, admin: client })
assert.equal(creationReply.status, 409, await creationReply.clone().text())
assert.equal(creationReply.headers.get("X-Storage-Delivery"), "synthetic-delivery")
assert.equal(creationReply.headers.get("X-Storage-Family"), "collection.create")
const creationError = await creationReply.json()
assert.equal(creationError.error.code, "storage_creation_rejected")
assert.deepEqual(creationError.error.rejection, { outcome: "rejected", operationId: creation.operationId, code: "inventory_revision_conflict", inventoryRevision: 8 })
const creationReplay = await handleStorageCommand(createRequest(), "collection.create", { session: client, admin: client })
assert.deepEqual((await creationReplay.json()).error.rejection, creationError.error.rejection)

process.env.HOLOFOLDER_E2E = "1"
delete process.env.VERCEL
process.env.VERCEL_ENV = "production"
const { GET, POST } = await import("../../app/e2e-harness/storage/[kind]/route")
const cookie = "hf-storage-fixture=synthetic-env-only-proof"
const deniedPost = await POST(request({ cookie }), { params: Promise.resolve({ kind: "slots" }) })
assert.equal(deniedPost.status, 503, "VERCEL_ENV alone must deny the synthetic executor")
const deniedRestore = await POST(request({ cookie }), { params: Promise.resolve({ kind: 'raw-restore' }) })
assert.equal(deniedRestore.status, 503, 'hosted environment cannot enable the raw restore harness')
const deniedGet = await GET(new Request("http://localhost:3529/app/e2e-harness/storage/inventory?requestId=synthetic-env-read&sessionId=epoch", { headers: { cookie } }), { params: Promise.resolve({ kind: "inventory" }) })
assert.equal(deniedGet.status, 503, "VERCEL_ENV alone must deny synthetic complete reads")
delete process.env.VERCEL_ENV
const allowed = await POST(request({ cookie }), { params: Promise.resolve({ kind: "slots" }) })
assert.equal(allowed.status, 200, "explicit non-hosted loopback harness stays usable")

}
main().catch(error => { console.error(error); process.exitCode = 1 })
