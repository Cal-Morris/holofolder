// The comps warm engine: bake sold comps + eBay asking checks for a list of cards (the want list, then
// optionally the rest of Show's hunt list) the morning of a show, so each card's last-known check is on
// this device. UI entry points (Prepare for card show, a Show "Check comps" button) call
// warmShowComps / useShowCompsWarm. Gentle on the provider allowance by design:
// cards whose pinned check is under 12 hours old are skipped without a request, the server skips any it
// already checked in the last 12 hours, only a couple of requests run at once, a 429/503 backs the whole
// batch off, and an exhausted or unconfigured source stops being asked for the rest of the batch.
// Credit gate: before any request, a run counts the cards that would need a sold comps call and refuses
// (without starting) when that's more than this device's daily sold comps budget has left; at
// CHECK_COMPS_CONFIRM_AT or more it asks confirmSpend first (Show passes one; Prepare doesn't).
import { requestCardPriceCheck, PriceCheckRequestError } from "@/lib/card-price-check-client"
import { isPriceCheckFresh, PRICE_CHECK_SOURCES, readPinnedCardPriceCheck } from "@/lib/card-price-check-cache"
import type { CardPriceCheck, PriceCheckSource } from "@/lib/card-price-checks"
import type { CardFinish } from "@/lib/domain/cards"

export const CHECK_COMPS_CONCURRENCY = 2
/** Most cards one run will check; the list is expected to come most-valuable first. */
export const CHECK_COMPS_MAX_CARDS = 60
const BACKOFF_MS = [2_000, 8_000, 20_000]
/** Sold comps provider calls one device may make per local calendar day through Check comps / Prepare. */
export const CHECK_COMPS_DAILY_SOLDCOMPS_BUDGET = 80
/** Runs needing this many sold comps calls or more ask confirmSpend before starting. */
export const CHECK_COMPS_CONFIRM_AT = 15
const BUDGET_KEY_PREFIX = "binderdex:check-comps:soldcomps-budget:"

export interface CheckCompsTarget { cardId: string; language?: string | null; finish?: CardFinish | null }
export interface CheckCompsProgress {
  done: number
  total: number
  /** Cards with a check that was already under 12 hours old (no provider call). */
  fresh: number
  /** Cards that now have a check under 12 hours old on this device (the server may have had it already). */
  checked: number
  failed: number
  /** Set when a source stopped for the rest of the run (allowance used up, not configured). */
  stopped: Partial<Record<PriceCheckSource, string>>
}

export interface CheckCompsSpendEstimate { cardsNeedingSoldcomps: number; remainingBudget: number; budget: number }
export type CheckCompsRefusal =
  | { reason: "budget"; needed: number; remaining: number; budget: number }
  | { reason: "cancelled"; needed: number }
export type CheckCompsOutcome =
  | { ok: true; progress: CheckCompsProgress }
  | { ok: false; refused: CheckCompsRefusal; progress: CheckCompsProgress }

export type CheckCompsBudgetStorage = Pick<Storage, "getItem" | "setItem">

function localDay(ms: number) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
export function soldcompsBudgetKey(ms: number) { return `${BUDGET_KEY_PREFIX}${localDay(ms)}` }

function defaultBudgetStorage(): CheckCompsBudgetStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage } catch { return null }
}
/** Sold comps calls already spent today on this device (0 when storage is unavailable). */
export function readSoldcompsSpent(ms: number, storage: CheckCompsBudgetStorage | null = defaultBudgetStorage()) {
  try {
    const value = Number(storage?.getItem(soldcompsBudgetKey(ms)) ?? 0)
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
  } catch { return 0 }
}
function addSoldcompsSpent(ms: number, storage: CheckCompsBudgetStorage | null) {
  try { storage?.setItem(soldcompsBudgetKey(ms), String(readSoldcompsSpent(ms, storage) + 1)) } catch { /* quota / private mode */ }
}

type Request = typeof requestCardPriceCheck
type ReadPinned = (cardId: string, finish: CardFinish | null | undefined, source: PriceCheckSource) => Promise<CardPriceCheck | null>

const STOP_PATTERN = /allowance used up|not configured/i

export function checkCompsTargets<T extends CheckCompsTarget>(targets: readonly T[]) {
  const seen = new Set<string>()
  return targets.filter(target => {
    if ((target.language ?? "en") !== "en" || target.finish === "jumbo") return false
    const key = `${target.cardId}:${target.finish ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, CHECK_COMPS_MAX_CARDS)
}

/** Wanted cards with an exact finish first (their checks match the printing), then the rest of the want
 *  list, then any extra hunt cards. Callers pass each list most-valuable first. */
export function showCompsTargets(wanted: readonly CheckCompsTarget[], hunt: readonly CheckCompsTarget[] = []) {
  const exact = (target: CheckCompsTarget) => target.finish === "normal" || target.finish === "holo" || target.finish === "reverse_holo"
  return checkCompsTargets([...wanted.filter(exact), ...wanted.filter(target => !exact(target)), ...hunt])
}

export function warmShowComps(input: { wanted: readonly CheckCompsTarget[]; hunt?: readonly CheckCompsTarget[] }, options: Parameters<typeof runCheckComps>[1]): Promise<CheckCompsOutcome> {
  return runCheckComps(showCompsTargets(input.wanted, input.hunt), options)
}

export async function runCheckComps(targets: readonly CheckCompsTarget[], options: {
  signal: AbortSignal
  onProgress?: (progress: CheckCompsProgress) => void
  request?: Request
  readPinned?: ReadPinned
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
  /** Asked before a run needing CHECK_COMPS_CONFIRM_AT+ sold comps calls; false refuses as cancelled. */
  confirmSpend?: (estimate: CheckCompsSpendEstimate) => boolean | Promise<boolean>
  /** Where today's sold comps spend is counted; defaults to localStorage. */
  budgetStorage?: CheckCompsBudgetStorage | null
}): Promise<CheckCompsOutcome> {
  const { signal, onProgress } = options
  const request = options.request ?? requestCardPriceCheck
  const readPinned = options.readPinned ?? readPinnedCardPriceCheck
  const sleep = options.sleep ?? wait
  const now = options.now ?? Date.now
  const queue = checkCompsTargets(targets)
  const budgetStorage = options.budgetStorage === undefined ? defaultBudgetStorage() : options.budgetStorage
  const progress: CheckCompsProgress = { done: 0, total: queue.length, fresh: 0, checked: 0, failed: 0, stopped: {} }
  const report = () => onProgress?.({ ...progress, stopped: { ...progress.stopped } })
  let cursor = 0
  let pausedUntil = 0

  // Gate: estimate sold comps calls (cards without a fresh pinned sold check) against today's budget.
  let needed = 0
  for (const target of queue) {
    if (signal.aborted) break
    if (!isPriceCheckFresh(await readPinned(target.cardId, target.finish, "soldcomps"), now())) needed += 1
  }
  const budget = CHECK_COMPS_DAILY_SOLDCOMPS_BUDGET
  const remaining = Math.max(0, budget - readSoldcompsSpent(now(), budgetStorage))
  if (needed > remaining) return { ok: false, refused: { reason: "budget", needed, remaining, budget }, progress }
  if (needed >= CHECK_COMPS_CONFIRM_AT && options.confirmSpend
    && !(await options.confirmSpend({ cardsNeedingSoldcomps: needed, remainingBudget: remaining, budget }))) {
    return { ok: false, refused: { reason: "cancelled", needed }, progress }
  }
  report()

  async function checkOne(target: CheckCompsTarget, source: PriceCheckSource): Promise<"fresh" | "checked" | "failed"> {
    const pinned = await readPinned(target.cardId, target.finish, source)
    if (isPriceCheckFresh(pinned, now())) return "fresh"
    if (progress.stopped[source]) return "failed"
    if (source === "soldcomps") {
      // Another tab or run may have spent today's budget since the estimate.
      if (readSoldcompsSpent(now(), budgetStorage) >= CHECK_COMPS_DAILY_SOLDCOMPS_BUDGET) {
        progress.stopped.soldcomps = "Sold comps daily limit reached."
        return "failed"
      }
    }
    for (let attempt = 0; ; attempt++) {
      if (pausedUntil > now()) await sleep(pausedUntil - now(), signal)
      if (signal.aborted) return "failed"
      // One spend per card, however many 429 retries it takes.
      if (source === "soldcomps" && attempt === 0) addSoldcompsSpent(now(), budgetStorage)
      try {
        const { check, error } = await request(target.cardId, target.language ?? "en", target.finish ?? undefined, source, signal)
        if (error && STOP_PATTERN.test(error)) progress.stopped[source] = error
        // A still-stale answer (cooling down, allowance used up) leaves the old check showing; count it as failed.
        return isPriceCheckFresh(check, now()) ? "checked" : "failed"
      } catch (error) {
        if (signal.aborted) return "failed"
        const status = error instanceof PriceCheckRequestError ? error.status : 0
        if ((status === 429 || status === 503) && attempt < BACKOFF_MS.length) {
          // Back the whole batch off, not just this card.
          pausedUntil = Math.max(pausedUntil, now() + BACKOFF_MS[attempt])
          continue
        }
        return "failed"
      }
    }
  }

  async function worker() {
    while (cursor < queue.length && !signal.aborted) {
      const target = queue[cursor++]
      const results: Array<"fresh" | "checked" | "failed"> = []
      for (const source of PRICE_CHECK_SOURCES) results.push(await checkOne(target, source))
      if (signal.aborted) return
      // A card counts by its sold check; asking is supporting evidence.
      const sold = results[PRICE_CHECK_SOURCES.indexOf("soldcomps")]
      progress[sold] += 1
      progress.done += 1
      report()
    }
  }

  await Promise.all(Array.from({ length: Math.min(CHECK_COMPS_CONCURRENCY, queue.length) }, worker))
  return { ok: true, progress }
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(done, ms)
    function done() { clearTimeout(timer); signal.removeEventListener("abort", done); resolve() }
    signal.addEventListener("abort", done)
  })
}
