import { test } from "node:test"
import assert from "node:assert/strict"
import { fetchAllRows } from "../lib/supabase/fetch-all-rows"

function pagedSource(total: number, failAtFrom?: number) {
  const calls: Array<[number, number]> = []
  const rows = Array.from({ length: total }, (_, index) => ({ id: index }))
  const fetchPage = async (from: number, to: number) => {
    calls.push([from, to])
    if (from === failAtFrom) return { data: null, error: new Error("boom") }
    return { data: rows.slice(from, to + 1), error: null }
  }
  return { calls, fetchPage }
}

test("fetchAllRows reads past the PostgREST row cap", async () => {
  const source = pagedSource(2350)
  const { data, error } = await fetchAllRows(source.fetchPage)
  assert.equal(error, null)
  assert.equal(data.length, 2350)
  assert.deepEqual(data.map((row) => row.id), Array.from({ length: 2350 }, (_, index) => index))
  assert.deepEqual(source.calls, [[0, 999], [1000, 1999], [2000, 2999]])
})

test("fetchAllRows stops after one request for small results", async () => {
  const source = pagedSource(991)
  const { data } = await fetchAllRows(source.fetchPage)
  assert.equal(data.length, 991)
  assert.equal(source.calls.length, 1)
})

test("fetchAllRows makes one extra request when the total is an exact multiple of the page", async () => {
  const source = pagedSource(1000)
  const { data } = await fetchAllRows(source.fetchPage)
  assert.equal(data.length, 1000)
  assert.equal(source.calls.length, 2)
})

test("fetchAllRows returns the error from a failed page", async () => {
  const source = pagedSource(2500, 1000)
  const { error } = await fetchAllRows(source.fetchPage)
  assert.ok(error instanceof Error)
})
