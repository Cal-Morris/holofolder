import { test } from "node:test"
import assert from "node:assert/strict"
import { normalizeComparisonTargets, countComparisonResult } from "@/lib/comparison-jobs"
import { isPriceCheckFresh } from "@/lib/card-price-check-cache"

test("manual refresh cooldown ends at 30 hours without expiring saved data", () => {
  const now = Date.parse("2026-11-07T18:00:00Z")
  assert.equal(isPriceCheckFresh({ checkedAt: "2026-11-06T12:00:01Z" }, now), true)
  assert.equal(isPriceCheckFresh({ checkedAt: "2026-11-06T12:00:00Z" }, now), false)
})

test("job targets reject invalid identities, preserve exact finish and deduplicate without the show cap", () => {
  const cards = Array.from({ length: 65 }, (_, i) => ({ cardId: `synthetic-${i}`, language: "en", finish: "normal" }))
  assert.equal(normalizeComparisonTargets([...cards, cards[0]])?.length, 65)
  assert.deepEqual(normalizeComparisonTargets([{ cardId: "base1-4-stamped", finish: "reverse_holo" }]), [{ cardId: "base1-4-stamped", language: "en", finish: "reverse_holo" }])
  for (const value of [null, {}, [{ cardId: "../bad" }], [{ cardId: "base1-4", language: "ja" }], [{ cardId: "base1-4", finish: "jumbo" }]]) assert.equal(normalizeComparisonTargets(value), null)
})

test("a printing with either failed source counts incomplete, preserving source stop messages", () => {
  const progress = { done: 2, total: 4, fresh: 1, checked: 1, failed: 0, stopped: {} }
  const next = countComparisonResult(progress, { result: "failed", stopped: { soldcomps: "Sold comps monthly allowance used up." } })
  assert.deepEqual(next, { done: 3, total: 4, fresh: 1, checked: 1, failed: 1, stopped: { soldcomps: "Sold comps monthly allowance used up." } })
  assert.equal(progress.done, 2)
})

test("job API enforces confirmation, owner isolation and cancellation, and reconnects repeated starts", async () => {
  const { execFileSync } = await import("node:child_process")
  execFileSync(process.execPath, [new URL("./fixtures/comparison-jobs-api.ts", import.meta.url).pathname], { stdio: "pipe" })
})

test("corrupt saved progress is rejected before it can crash the offline view", async () => {
  const { normalizeComparisonJob } = await import("@/lib/comparison-jobs")
  const job = { id: "00000000-0000-4000-8000-000000000050", status: "running", progress: { total: 2, done: 1, checked: 1, fresh: 0, failed: 0, stopped: {} } }
  assert.deepEqual(normalizeComparisonJob(job), job)
  for (const stopped of [undefined, null, [], { unknown: "bad" }, { ebay: {} }]) assert.equal(normalizeComparisonJob({ ...job, progress: { ...job.progress, stopped } }), null)
  assert.equal(normalizeComparisonJob({ ...job, progress: { ...job.progress, done: -1 } }), null)
})
