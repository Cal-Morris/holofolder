// Show mode's session tally: what was bought at this card show, queued on the device and synced with the account. Pure and client-safe.
// A session starts on the first purchase and quietly resets once it is older than a day of show-going,
// so the next show starts from zero without a "clear" step. Amounts are in the display currency at the time.

export const SHOW_SESSION_KEY = 'binderdex:show-session:v1';
export const SHOW_SESSION_EVENT = 'binderdex:show-session';
export const SHOW_SESSION_MAX_AGE_MS = 18 * 60 * 60 * 1000;

export interface ShowPurchase {
  id: string;
  cardId: string;
  cardName: string;
  language: string;
  finish: string;
  /** What you paid, in `currency`. */
  price: number;
  /** Market price at the time, in `currency`, when known. */
  marketPrice: number | null;
  currency: string;
  at: number;
  /** Set when the card was bought as part of a bundle. */
  bundleId?: string;
}

export interface ShowSession {
  startedAt: number;
  purchases: ShowPurchase[];
  /**
   * When the tally was last cleared (by hand, or when the last show's session ran out). Purchases synced from
   * the account from before this are left out, so a cleared tally stays cleared on every device.
   */
  clearedAt?: number;
}

const isPurchase = (value: unknown): value is ShowPurchase => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === 'string' &&
    typeof entry.cardId === 'string' &&
    typeof entry.cardName === 'string' &&
    typeof entry.price === 'number' &&
    Number.isFinite(entry.price) &&
    entry.price >= 0 &&
    typeof entry.currency === 'string' &&
    typeof entry.at === 'number'
  );
};

export function emptyShowSession(now: number): ShowSession {
  return { startedAt: now, purchases: [] };
}

export function parseShowSession(raw: string | null | undefined, now: number): ShowSession {
  if (!raw) return emptyShowSession(now);
  try {
    const value = JSON.parse(raw) as Partial<ShowSession>;
    const startedAt = typeof value.startedAt === 'number' && Number.isFinite(value.startedAt) ? value.startedAt : now;
    if (now - startedAt > SHOW_SESSION_MAX_AGE_MS)
      return { ...emptyShowSession(now), clearedAt: startedAt + SHOW_SESSION_MAX_AGE_MS };
    const clearedAt =
      typeof value.clearedAt === 'number' && Number.isFinite(value.clearedAt) ? value.clearedAt : undefined;
    const purchases = Array.isArray(value.purchases)
      ? value.purchases.flatMap((entry: unknown) =>
          isPurchase(entry)
            ? [
                {
                  ...entry,
                  language: typeof entry.language === 'string' ? entry.language : 'en',
                  finish: typeof entry.finish === 'string' ? entry.finish : 'normal',
                  marketPrice:
                    typeof entry.marketPrice === 'number' && Number.isFinite(entry.marketPrice)
                      ? entry.marketPrice
                      : null,
                },
              ]
            : [],
        )
      : [];
    return clearedAt === undefined ? { startedAt, purchases } : { startedAt, purchases, clearedAt };
  } catch {
    return emptyShowSession(now);
  }
}

export function addShowPurchase(session: ShowSession, purchase: ShowPurchase, now: number): ShowSession {
  const expired = now - session.startedAt > SHOW_SESSION_MAX_AGE_MS;
  const base =
    session.purchases.length === 0 || expired
      ? withClearedAt(emptyShowSession(now), expired ? session.startedAt + SHOW_SESSION_MAX_AGE_MS : session.clearedAt)
      : session;
  return { ...base, purchases: [...base.purchases, purchase] };
}

/** An empty tally that ignores account purchases from before `now` (Settings → Clear). */
export function clearedShowSession(now: number): ShowSession {
  return { ...emptyShowSession(now), clearedAt: now };
}

function withClearedAt(session: ShowSession, clearedAt: number | undefined): ShowSession {
  return clearedAt === undefined ? session : { ...session, clearedAt };
}

export function removeShowPurchases(session: ShowSession, ids: readonly string[]): ShowSession {
  const drop = new Set(ids);
  return { ...session, purchases: session.purchases.filter((entry) => !drop.has(entry.id)) };
}

export interface ShowSessionSummary {
  count: number;
  spent: number;
  /** Market value of the purchases that had a market price. */
  marketValue: number;
  /** marketValue minus what was paid for those same cards; positive = you paid under market. */
  saved: number;
  currency: string | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Totals in `currency` (purchases logged in another currency are left out). Without one, the
 * latest purchase's currency is used, so the tally follows whatever the checks were priced in.
 */
export function summarizeShowSession(
  session: ShowSession,
  currency = session.purchases.at(-1)?.currency ?? '',
): ShowSessionSummary {
  const entries = session.purchases.filter((entry) => entry.currency === currency);
  const priced = entries.filter((entry) => entry.marketPrice !== null);
  const marketValue = priced.reduce((sum, entry) => sum + (entry.marketPrice ?? 0), 0);
  return {
    count: entries.length,
    spent: round(entries.reduce((sum, entry) => sum + entry.price, 0)),
    marketValue: round(marketValue),
    saved: round(marketValue - priced.reduce((sum, entry) => sum + entry.price, 0)),
    currency: entries.length > 0 ? currency : null,
  };
}

/** Splits a bundle's total across its cards in proportion to market price (evenly when none is priced). */
export function splitBundlePrice(total: number, marketPrices: ReadonlyArray<number | null>): number[] {
  if (marketPrices.length === 0) return [];
  const known = marketPrices.map((price) => (typeof price === 'number' && price > 0 ? price : 0));
  const knownTotal = known.reduce((sum, price) => sum + price, 0);
  const raw =
    knownTotal > 0 && known.every((price) => price > 0)
      ? known.map((price) => (total * price) / knownTotal)
      : marketPrices.map(() => total / marketPrices.length);
  const rounded = raw.map(round);
  // Put any rounding remainder on the last card so the parts add up to the total.
  rounded[rounded.length - 1] = round(
    rounded[rounded.length - 1] + (total - rounded.reduce((sum, price) => sum + price, 0)),
  );
  return rounded;
}
