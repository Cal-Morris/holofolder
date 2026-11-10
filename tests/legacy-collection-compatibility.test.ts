import { test } from "node:test"
import assert from "node:assert/strict"
import { CollectionWriteError, saveRemoteCollectionItem, deleteRemoteCollectionItem } from "../lib/collection/remote"
import { classifyWriteFailure } from "../lib/collection/sync"
import { LOCAL_COLLECTION_PENDING_OPS_KEY, pauseLegacyCollectionOperation, readPendingCollectionOperations, readLegacyQueueSources, writePendingCollectionOperations, queuePendingCollectionOperation, rebasePendingCollectionOperation, removePendingCollectionOperation } from "../lib/collection/offline-queue"
import type { CollectedPokemon } from "../lib/domain/cards"

const code = "binder_converted_requires_slot_commands"
// Synthetic fixtures, including unknown historical fields that must remain recoverable.
const item: CollectedPokemon = { id: "synthetic-row", pokemon_id: 25, pokemon_name: "Synthetic", status: "collected", wanted_cards: [], collected_at: "2026-11-10" }

for (const type of ["delete", "upsert", "import"] as const) for (const withBase of [false, true]) {
  test(`${type}, base=${withBase}: exact 409 without item pauses and preserves the record through reload`, async () => {
    const originalFetch = globalThis.fetch
    const globals = globalThis as { window?: unknown }
    const originalWindow = globals.window
    const record = { id: "original-id", type: type === "delete" ? "delete" : "upsert", pokemonId: 25,
      ...(type !== "delete" ? { item: { ...item, historical: 'raw "quoted", [data]' }, acquisition: { operationId: "original-acquisition", recipientId: "original-recipient", extra: "keep" } } : {}),
      ...(type === "import" ? { importOnly: true } : {}), ...(withBase ? { base: { ...item, historicalBase: true } } : {}),
      queuedAt: "original-time", binderId: "original-binder", recipientOwner: "original-owner", extra: ["keep"] }
    const rawRecord = `\n  ${JSON.stringify(record, null, 2)}\n`
    let stored = `[${rawRecord}]`
    globals.window = { localStorage: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } } }
    let calls = 0
    globalThis.fetch = (async () => { calls++; return Response.json({ error: "Use slot commands", code }, { status: 409 }) }) as typeof fetch
    try {
      const operation = record
      await assert.rejects(type === "delete" ? deleteRemoteCollectionItem(25) : saveRemoteCollectionItem(item), error => {
        assert.ok(error instanceof CollectionWriteError)
        assert.equal(error.code, code)
        assert.equal(error.serverItem, null)
        assert.equal(classifyWriteFailure(error), "compatibility")
        pauseLegacyCollectionOperation(operation.id)
        return true
      })
      assert.equal(calls, 1)
      const paused = readPendingCollectionOperations()[0]
      assert.equal(paused.compatibilityPause?.rawRecord, rawRecord)
      assert.deepEqual(JSON.parse(paused.compatibilityPause!.rawRecord), record)
      const { compatibilityPause: _pause, ...retained } = paused
      assert.deepEqual(retained, record)
      const persisted = stored
      writePendingCollectionOperations(readPendingCollectionOperations())
      assert.equal(stored, persisted, "unchanged record after reload and persistence")
      rebasePendingCollectionOperation(25, null, "original-binder")
      removePendingCollectionOperation(operation.id)
      assert.equal(stored, persisted, "settlement cannot remove or rebase paused intent")
      queuePendingCollectionOperation({ type: "delete", pokemonId: 25, binderId: "original-binder" })
      assert.deepEqual(readPendingCollectionOperations()[0], paused, "new edits cannot replace paused intent")
      assert.equal(LOCAL_COLLECTION_PENDING_OPS_KEY, "pokemon_collection_pending_ops_v1")
    } finally { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globals.window; else globals.window = originalWindow }
  })
}

test("other 409 codes remain conflicts, billing and network/service failures retain their policy", async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const payload of [{ error: "changed", item }, { error: "absent" }, { error: "other", code: "different", item }]) {
      globalThis.fetch = (async () => Response.json(payload, { status: 409 })) as typeof fetch
      await assert.rejects(saveRemoteCollectionItem(item), error => {
        assert.ok(error instanceof CollectionWriteError)
        assert.equal(classifyWriteFailure(error), "conflict")
        assert.equal(error.serverItem?.id ?? null, "item" in payload ? item.id : null)
        return true
      })
    }
    for (const status of [503, 402]) {
      globalThis.fetch = (async () => Response.json({ error: "unavailable", code }, { status })) as typeof fetch
      await assert.rejects(saveRemoteCollectionItem(item), error => { assert.equal(classifyWriteFailure(error), status === 402 ? "paused" : "retry"); return true })
    }
    globalThis.fetch = (async () => { throw new TypeError("offline") }) as typeof fetch
    await assert.rejects(deleteRemoteCollectionItem(25), error => { assert.equal(classifyWriteFailure(error), "retry"); return true })
  } finally { globalThis.fetch = originalFetch }
})

test("a newer edit during a send cannot erase the rejected original record", () => {
  const globals = globalThis as { window?: unknown }
  const previous = globals.window
  const original = { id: "original", type: "delete", pokemonId: 25, base: item, binderId: "binder", queuedAt: "original-time" }
  const newer = { ...original, id: "newer", base: null }
  const raw = JSON.stringify(original, null, 2)
  let stored = JSON.stringify([newer])
  globals.window = { localStorage: { getItem: () => stored, setItem: (_key: string, value: string) => { stored = value } } }
  try {
    pauseLegacyCollectionOperation(original.id, raw)
    const [paused] = readPendingCollectionOperations()
    assert.equal(paused.compatibilityPause!.rawRecord, raw)
    const { compatibilityPause: _pause, ...retainedOriginal } = paused
    assert.deepEqual(retainedOriginal, original)
    assert.deepEqual(JSON.parse(readLegacyQueueSources()[0].legacyQueueSource.raw), [newer])
  } finally { if (previous === undefined) delete globals.window; else globals.window = previous }
})

test("an interrupted 409 error body is retried without treating it as an absent row", async () => {
  const previous = globalThis.fetch
  globalThis.fetch = (async () => new Response("{interrupted", { status: 409 })) as typeof fetch
  try {
    await assert.rejects(saveRemoteCollectionItem(item), error => { assert.equal(classifyWriteFailure(error), "retry"); return true })
  } finally { globalThis.fetch = previous }
})
