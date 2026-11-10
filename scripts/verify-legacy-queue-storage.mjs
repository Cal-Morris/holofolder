import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { chromium } from "@playwright/test"

// Real Chromium, isolated synthetic origin, two pages/connections. No app server or hosted writes.
const dir = await mkdtemp(join(tmpdir(), "holofolder-legacy-storage-"))
let browser
try {
  const output = join(dir, "proof.js")
  const build = spawnSync("bun", ["build", "tests/fixtures/legacy-queue-browser.ts", "--target=browser", `--outfile=${output}`], { encoding: "utf8" })
  assert.equal(build.status, 0, build.stderr)
  const bundle = await readFile(output, "utf8")
  assert.doesNotMatch(bundle, /SUPABASE_SERVICE_ROLE_KEY|lib\/server\//)
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) })
  const context = await browser.newContext({ serviceWorkers: "block" })
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Synthetic legacy storage proof</title>" }))
  const open = async () => {
    const page = await context.newPage()
    await page.goto("https://synthetic-legacy-queue.test")
    await page.addScriptTag({ content: bundle })
    return page
  }
  const a = await open(), b = await open()
  await a.evaluate(() => globalThis.legacyQueueProof.singleSeed())
  const singleClaims = await Promise.all([a.evaluate(() => globalThis.legacyQueueProof.singleClaim()), b.evaluate(() => globalThis.legacyQueueProof.singleClaim())])
  assert.equal(singleClaims.filter(Boolean).length, 1)
  await assert.rejects(a.evaluate(() => globalThis.legacyQueueProof.abortInitialization()), /transaction aborted/)
  assert.equal(await a.evaluate(() => globalThis.legacyQueueProof.putSucceeded()), true)
  assert.equal(await b.evaluate(() => globalThis.legacyQueueProof.envelope()), undefined)
  await Promise.all([a.evaluate(() => globalThis.legacyQueueProof.initialize()), b.evaluate(() => globalThis.legacyQueueProof.initialize())])
  assert.equal((await a.evaluate(() => globalThis.legacyQueueProof.read())).sources.length, 1)
  await Promise.all([a.evaluate(() => globalThis.legacyQueueProof.append(1)), b.evaluate(() => globalThis.legacyQueueProof.append(2))])
  assert.deepEqual((await a.evaluate(() => globalThis.legacyQueueProof.read())).entries.map(e => e.operation.pokemonId).sort(), [1, 2])
  await assert.rejects(b.evaluate(() => globalThis.legacyQueueProof.append(1)), /queue_changed/)
  let before = await a.evaluate(() => globalThis.legacyQueueProof.envelope())
  await assert.rejects(a.evaluate(() => globalThis.legacyQueueProof.abortEnqueue()), /transaction aborted/)
  assert.equal(await a.evaluate(() => globalThis.legacyQueueProof.putSucceeded()), true)
  assert.deepEqual(await b.evaluate(() => globalThis.legacyQueueProof.envelope()), before)
  await assert.rejects(a.evaluate(() => globalThis.legacyQueueProof.abortReview()), /transaction aborted/)
  assert.equal(await a.evaluate(() => globalThis.legacyQueueProof.putSucceeded()), true)
  assert.deepEqual(await b.evaluate(() => globalThis.legacyQueueProof.envelope()), before)
  for (const kind of ["throw", "clone", "outside"]) {
    await assert.rejects(a.evaluate(kind => globalThis.legacyQueueProof.primitiveFailure(kind), kind))
    assert.deepEqual(await b.evaluate(() => globalThis.legacyQueueProof.primitiveValues()), [undefined, undefined, undefined])
  }
  const staleReview = await a.evaluate(() => globalThis.legacyQueueProof.review())
  await b.evaluate(() => globalThis.legacyQueueProof.append(3))
  await assert.rejects(a.evaluate(review => globalThis.legacyQueueProof.queue.acceptReview(review.token, review.sources, review.selections), staleReview), /queue_changed/)
  // Race on a single ready slot: the first claimant wins, the second may progress another slot.
  const claims = await Promise.all([a.evaluate(() => globalThis.legacyQueueProof.claim(0, "tab-a")), b.evaluate(() => globalThis.legacyQueueProof.claim(0, "tab-b"))])
  assert.ok(claims[0] && claims[1])
  assert.notEqual(claims[0].entryId, claims[1].entryId)
  const head = claims.find(c => c.request.url.includes("pokemonId=1"))
  assert.ok(head)
  const entry = (await a.evaluate(() => globalThis.legacyQueueProof.read())).entries.find(e => e.entryId === head.entryId)
  await a.evaluate(revision => globalThis.legacyQueueProof.append(1, revision), entry.revision)
  before = await a.evaluate(() => globalThis.legacyQueueProof.envelope())
  assert.equal(await b.evaluate(claim => globalThis.legacyQueueProof.queue.settle({ ...claim, token: "stale" }, { kind: "acknowledged", item: null }), head), false)
  assert.deepEqual(await a.evaluate(() => globalThis.legacyQueueProof.envelope()), before)
  await assert.rejects(b.evaluate(claim => globalThis.legacyQueueProof.abortSettle(claim), head), /transaction aborted/)
  assert.equal(await b.evaluate(() => globalThis.legacyQueueProof.putSucceeded()), true)
  assert.deepEqual(await a.evaluate(() => globalThis.legacyQueueProof.envelope()), before)
  await a.evaluate(() => globalThis.legacyQueueProof.switchSession())
  assert.equal(await a.evaluate(claim => globalThis.legacyQueueProof.queue.settle(claim, { kind: "acknowledged", item: null }), head), false)
  await b.evaluate(() => globalThis.legacyQueueProof.claim(60001, "tab-b"))
  const expired = (await b.evaluate(() => globalThis.legacyQueueProof.read())).entries.find(e => e.entryId === head.entryId)
  assert.equal(expired.state, "unknown")
  assert.deepEqual(expired.request, head.request)
  before = await b.evaluate(() => globalThis.legacyQueueProof.envelope())
  await b.evaluate(() => globalThis.legacyQueueProof.overwriteOld())
  await b.evaluate(() => globalThis.legacyQueueProof.queue.observeOldSource({ kind: "local-storage", raw: "[]" }))
  assert.deepEqual((await b.evaluate(() => globalThis.legacyQueueProof.envelope())).entries, before.entries)
  await b.reload(); await b.addScriptTag({ content: bundle })
  assert.deepEqual((await b.evaluate(() => globalThis.legacyQueueProof.envelope())).entries, before.entries)
  const c = await open()
  const review = await b.evaluate(() => globalThis.legacyQueueProof.review())
  const accepted = await Promise.allSettled([b.evaluate(review => globalThis.legacyQueueProof.queue.acceptReview(review.token, review.sources, review.selections), review), c.evaluate(review => globalThis.legacyQueueProof.queue.acceptReview(review.token, review.sources, review.selections), review)])
  assert.equal(accepted.filter(result => result.status === "fulfilled").length, 1)
  const reviewed = await c.evaluate(() => globalThis.legacyQueueProof.read())
  assert.deepEqual(reviewed.sources[0].accepted, [0])
  assert.equal(reviewed.entries.filter(entry => entry.operation.pokemonId === 99 && entry.state === "ready").length, 1)
  assert.deepEqual(await c.evaluate(() => globalThis.legacyQueueProof.reviewRegressions()), { blocked: true, hidden: true, retained: true, paused: true, states: ["unknown", "paused"] })
  console.log("PASS Chromium: separate connections, simultaneous initialization/appends, stale same-slot/review/session/token fences, one competing claim/acceptance, abort-after-put enqueue/review/initialization/settlement, clone/transform/write-scope rollback, expiry unknown, old mirror/reload preservation, compatibility barrier, nested privacy and reviewed expiry")
  await context.close()
} finally {
  await browser?.close()
  await rm(dir, { recursive: true, force: true })
}
