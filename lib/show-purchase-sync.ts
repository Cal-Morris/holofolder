// Show purchases on the account (public.show_purchases), read-only on the device. Pure and client-safe.
// Purchases are added and removed through the developer API (lib/server/operations/show-purchases.ts); the app
// pulls the account's purchases for the current show so the tally shows them, for a shared partner too.
import { SHOW_SESSION_MAX_AGE_MS, type ShowPurchase, type ShowSession } from './show-session';

export interface ShowPurchaseRow {
  owner_user_id: string;
  client_id: string;
  card_id: string;
  card_name: string;
  language: string;
  finish: string;
  price: number;
  market_price: number | null;
  currency: string;
  bought_at: string;
  bundle_id: string | null;
}

export const SHOW_PURCHASE_COLUMNS =
  'owner_user_id,client_id,card_id,card_name,language,finish,price,market_price,currency,bought_at,bundle_id';

const toNumber = (value: unknown) =>
  typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;

export function fromShowPurchaseRow(row: Partial<Record<keyof ShowPurchaseRow, unknown>>): ShowPurchase | null {
  const price = toNumber(row.price);
  const market = row.market_price === null || row.market_price === undefined ? null : toNumber(row.market_price);
  const at = typeof row.bought_at === 'string' ? Date.parse(row.bought_at) : NaN;
  if (typeof row.client_id !== 'string' || typeof row.card_id !== 'string' || typeof row.currency !== 'string')
    return null;
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(at)) return null;
  return {
    id: row.client_id,
    cardId: row.card_id,
    cardName: typeof row.card_name === 'string' ? row.card_name : row.card_id,
    language: typeof row.language === 'string' ? row.language : 'en',
    finish: typeof row.finish === 'string' ? row.finish : 'normal',
    price,
    marketPrice: market !== null && Number.isFinite(market) ? market : null,
    currency: row.currency,
    at,
    ...(typeof row.bundle_id === 'string' && row.bundle_id ? { bundleId: row.bundle_id } : {}),
  };
}

/** Account purchases from this moment on belong to the current show. */
export function showSyncWindowStart(session: ShowSession, now: number): number {
  return Math.max(now - SHOW_SESSION_MAX_AGE_MS, session.clearedAt ?? 0);
}

/** The tally after a pull: exactly the account's purchases for this show. */
export function reconcileShowSession(
  session: ShowSession,
  remote: readonly ShowPurchase[],
  since: number,
): ShowSession {
  const purchases = remote
    .filter((purchase) => purchase.at >= since)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const earliest = purchases[0]?.at;
  return { ...session, startedAt: earliest === undefined ? session.startedAt : earliest, purchases };
}

export const sameShowPurchases = (a: ShowSession, b: ShowSession) =>
  a.startedAt === b.startedAt &&
  a.purchases.length === b.purchases.length &&
  a.purchases.every((purchase, index) => purchase.id === b.purchases[index].id);

/** The account side, so the pull can be tested without Supabase. Throws on failure. */
export interface ShowPurchaseRemote {
  listSince(sinceIso: string): Promise<Array<Partial<Record<keyof ShowPurchaseRow, unknown>>>>;
}

export interface ShowPurchaseStore {
  readSession(now: number): ShowSession;
  writeSession(session: ShowSession): void;
}

/** Pulls this show's purchases into the tally. A failed pull leaves the tally as it is. */
export async function pullShowPurchases({
  remote,
  store,
  now = Date.now(),
}: {
  remote: ShowPurchaseRemote;
  store: ShowPurchaseStore;
  now?: number;
}): Promise<{ pulled: number; changed: boolean }> {
  const since = showSyncWindowStart(store.readSession(now), now);
  const rows = await remote.listSince(new Date(since).toISOString());
  const pulled = rows.map(fromShowPurchaseRow).filter((purchase): purchase is ShowPurchase => purchase !== null);
  const session = store.readSession(now);
  const next = reconcileShowSession(session, pulled, since);
  const changed = !sameShowPurchases(session, next);
  if (changed) store.writeSession(next);
  return { pulled: pulled.length, changed };
}
