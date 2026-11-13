// Warm missing comparisons for Show and offline use. Saved checks never expire; only the card's
// explicit refresh action replaces them. Requests are bounded and back off on provider failures.
import { requestCardPriceCheck, PriceCheckRequestError } from '@/lib/card-price-check-client';
import { priceCheckFinish, PRICE_CHECK_SOURCES, readPinnedCardPriceCheck } from '@/lib/card-price-check-cache';
import type { CardPriceCheck, PriceCheckSource } from '@/lib/card-price-checks';
import type { CardFinish } from '@/lib/domain/cards';

export const CHECK_COMPS_CONCURRENCY = 2;
/** Most unchecked cards one Show run will check; the list is expected to come most-valuable first. */
export const CHECK_COMPS_MAX_CARDS = 60;
const BACKOFF_MS = [2_000, 8_000, 20_000];
const SOLD_INDEX = PRICE_CHECK_SOURCES.indexOf('soldcomps');
/** Runs needing this many sold comps calls or more ask confirmSpend before starting. */
export const CHECK_COMPS_CONFIRM_AT = 15;

export interface CheckCompsTarget {
  cardId: string;
  language?: string | null;
  finish?: CardFinish | null;
}
export interface CheckCompsProgress {
  done: number;
  total: number;
  /** Cards with a check that was already saved (no provider call). */
  fresh: number;
  /** Cards that now have a check saved on this device (the server may have had it already). */
  checked: number;
  failed: number;
  /** Set when a source stopped for the rest of the run (allowance used up, not configured). */
  stopped: Partial<Record<PriceCheckSource, string>>;
}

export interface CheckCompsSpendEstimate {
  cardsNeedingSoldcomps: number;
}
export type CheckCompsRefusal = { reason: 'cancelled'; needed: number };
export type CheckCompsOutcome =
  { ok: true; progress: CheckCompsProgress } | { ok: false; refused: CheckCompsRefusal; progress: CheckCompsProgress };

type Request = typeof requestCardPriceCheck;
type ReadPinned = (
  cardId: string,
  finish: CardFinish | null | undefined,
  source: PriceCheckSource,
) => Promise<CardPriceCheck | null>;

const STOP_PATTERN = /allowance used up|not configured/i;

export function checkCompsTargets<T extends CheckCompsTarget>(
  targets: readonly T[],
  scope: 'show' | 'collection' = 'show',
) {
  const seen = new Set<string>();
  return targets
    .filter((target) => {
      if (!target.cardId || (target.language ?? 'en') !== 'en' || target.finish === 'jumbo') return false;
      const key = `${target.cardId}:${priceCheckFinish(target.finish)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, scope === 'collection' ? undefined : CHECK_COMPS_MAX_CARDS);
}

/** Wanted cards with an exact finish first (their checks match the printing), then the rest of the want
 *  list, then any extra hunt cards. Callers pass each list most-valuable first. */
export function showCompsTargets(wanted: readonly CheckCompsTarget[], hunt: readonly CheckCompsTarget[] = []) {
  const exact = (target: CheckCompsTarget) =>
    target.finish === 'normal' || target.finish === 'holo' || target.finish === 'reverse_holo';
  return checkCompsTargets(
    [...wanted.filter(exact), ...wanted.filter((target) => !exact(target)), ...hunt],
    'collection',
  );
}

export function warmShowComps(
  input: { wanted: readonly CheckCompsTarget[]; hunt?: readonly CheckCompsTarget[] },
  options: Parameters<typeof runCheckComps>[1],
): Promise<CheckCompsOutcome> {
  return runCheckComps(showCompsTargets(input.wanted, input.hunt), options);
}

export async function runCheckComps(
  targets: readonly CheckCompsTarget[],
  options: {
    signal: AbortSignal;
    /** Explicit collection actions check every eligible printing; Show stays capped. */
    scope?: 'show' | 'collection';
    onProgress?: (progress: CheckCompsProgress) => void;
    request?: Request;
    readPinned?: ReadPinned;
    sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
    now?: () => number;
    /** Asked before a run needing CHECK_COMPS_CONFIRM_AT+ sold comps calls; false refuses as cancelled. */
    confirmSpend?: (estimate: CheckCompsSpendEstimate) => boolean | Promise<boolean>;
  },
): Promise<CheckCompsOutcome> {
  const { signal, onProgress } = options;
  const request = options.request ?? requestCardPriceCheck;
  const readPinned = options.readPinned ?? readPinnedCardPriceCheck;
  const sleep = options.sleep ?? wait;
  const now = options.now ?? Date.now;
  const queue: CheckCompsTarget[] = [];
  const progress: CheckCompsProgress = { done: 0, total: queue.length, fresh: 0, checked: 0, failed: 0, stopped: {} };
  const report = () => onProgress?.({ ...progress, stopped: { ...progress.stopped } });
  let cursor = 0;
  let pausedUntil = 0;

  // Soft gate: estimate sold comps calls (cards without a saved pinned sold check); ask before a big run.
  let needed = 0;
  for (const target of checkCompsTargets(targets, 'collection')) {
    if (signal.aborted) break;
    const soldFresh = Boolean(await readPinned(target.cardId, target.finish, 'soldcomps'));
    // Saved cards must not occupy the next batch's slots.
    if (options.scope !== 'collection' && soldFresh && Boolean(await readPinned(target.cardId, target.finish, 'ebay')))
      continue;
    queue.push(target);
    if (!soldFresh) needed += 1;
    if (options.scope !== 'collection' && queue.length === CHECK_COMPS_MAX_CARDS) break;
  }
  progress.total = queue.length;
  if (signal.aborted) return { ok: false, refused: { reason: 'cancelled', needed }, progress };
  if (
    needed >= CHECK_COMPS_CONFIRM_AT &&
    options.confirmSpend &&
    !(await options.confirmSpend({ cardsNeedingSoldcomps: needed }))
  ) {
    return { ok: false, refused: { reason: 'cancelled', needed }, progress };
  }
  report();

  async function checkOne(target: CheckCompsTarget, source: PriceCheckSource): Promise<'fresh' | 'checked' | 'failed'> {
    const pinned = await readPinned(target.cardId, target.finish, source);
    if (pinned) return 'fresh';
    if (progress.stopped[source]) return 'failed';
    for (let attempt = 0; ; attempt++) {
      if (pausedUntil > now()) await sleep(pausedUntil - now(), signal);
      if (signal.aborted) return 'failed';
      try {
        const { check, error } = await request(
          target.cardId,
          target.language ?? 'en',
          target.finish ?? undefined,
          source,
          signal,
        );
        if (error && STOP_PATTERN.test(error)) progress.stopped[source] = error;
        // A saved answer is usable regardless of age.
        return check ? 'checked' : 'failed';
      } catch (error) {
        if (signal.aborted) return 'failed';
        const status = error instanceof PriceCheckRequestError ? error.status : 0;
        if ((status === 429 || status === 503) && attempt < BACKOFF_MS.length) {
          // Back the whole batch off, not just this card.
          pausedUntil = Math.max(pausedUntil, now() + BACKOFF_MS[attempt]);
          continue;
        }
        return 'failed';
      }
    }
  }

  async function worker() {
    while (cursor < queue.length && !signal.aborted) {
      const target = queue[cursor++];
      const results: Array<'fresh' | 'checked' | 'failed'> = [];
      for (const source of PRICE_CHECK_SOURCES) results.push(await checkOne(target, source));
      if (signal.aborted) return;
      // A card counts by its sold check; asking is supporting evidence.
      const sold = results[SOLD_INDEX];
      const result =
        options.scope === 'collection'
          ? results.includes('failed')
            ? 'failed'
            : results.every((result) => result === 'fresh')
              ? 'fresh'
              : 'checked'
          : sold;
      progress[result] += 1;
      progress.done += 1;
      report();
    }
  }

  await Promise.all(Array.from({ length: Math.min(CHECK_COMPS_CONCURRENCY, queue.length) }, worker));
  return { ok: true, progress };
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });
}
