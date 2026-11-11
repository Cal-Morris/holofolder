// Show purchases on the account (public.show_purchases), offline-first. Pure and client-safe.
// Every purchase or undo goes into a local queue first; a sync pushes the queue (inserts are idempotent on
// (owner_user_id, client_id), so a retry or a second tab can't duplicate a purchase), then pulls the
// account's purchases for the current show so the tally survives a reinstall and the shared partner sees it.
import { SHOW_SESSION_MAX_AGE_MS, type ShowPurchase, type ShowSession } from './show-session';

export const SHOW_PURCHASE_QUEUE_KEY = 'binderdex:show-purchase-queue:v1';
/** Plenty for any show; keeps a device that never signs in from growing the queue forever. */
export const SHOW_PURCHASE_QUEUE_LIMIT = 500;

export type ShowPurchaseOp = { op: 'add'; purchase: ShowPurchase } | { op: 'remove'; id: string };

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

const isOp = (value: unknown): value is ShowPurchaseOp => {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  if (entry.op === 'remove') return typeof entry.id === 'string';
  if (entry.op !== 'add' || !entry.purchase || typeof entry.purchase !== 'object') return false;
  const purchase = entry.purchase as Record<string, unknown>;
  return (
    typeof purchase.id === 'string' &&
    typeof purchase.cardId === 'string' &&
    typeof purchase.price === 'number' &&
    typeof purchase.currency === 'string' &&
    typeof purchase.at === 'number'
  );
};

export function parseShowPurchaseQueue(raw: string | null | undefined): ShowPurchaseOp[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isOp) : [];
  } catch {
    return [];
  }
}

const opId = (op: ShowPurchaseOp) => (op.op === 'add' ? op.purchase.id : op.id);

export function queueShowPurchaseAdds(
  queue: readonly ShowPurchaseOp[],
  purchases: readonly ShowPurchase[],
): ShowPurchaseOp[] {
  return [...queue, ...purchases.map((purchase) => ({ op: 'add' as const, purchase }))].slice(
    -SHOW_PURCHASE_QUEUE_LIMIT,
  );
}

/** Undo: a purchase that never reached the account is simply dropped from the queue; otherwise it's deleted there. */
export function queueShowPurchaseRemovals(queue: readonly ShowPurchaseOp[], ids: readonly string[]): ShowPurchaseOp[] {
  const unsent = new Set(queue.filter((op) => op.op === 'add').map(opId));
  const drop = new Set(ids);
  const kept = queue.filter((op) => !(op.op === 'add' && drop.has(op.purchase.id)));
  const removals = ids.filter((id) => !unsent.has(id)).map((id) => ({ op: 'remove' as const, id }));
  return [...kept, ...removals].slice(-SHOW_PURCHASE_QUEUE_LIMIT);
}

/** Drops exactly the ops a sync sent, keeping anything queued while it ran. */
export function withoutSentOps(queue: readonly ShowPurchaseOp[], sent: readonly ShowPurchaseOp[]): ShowPurchaseOp[] {
  const sentKeys = new Set(sent.map((op) => `${op.op}:${opId(op)}`));
  return queue.filter((op) => !sentKeys.has(`${op.op}:${opId(op)}`));
}

export function toShowPurchaseRow(purchase: ShowPurchase, ownerUserId: string): ShowPurchaseRow {
  return {
    owner_user_id: ownerUserId,
    client_id: purchase.id,
    card_id: purchase.cardId,
    card_name: purchase.cardName,
    language: purchase.language || 'en',
    finish: purchase.finish || 'normal',
    price: purchase.price,
    market_price: purchase.marketPrice,
    currency: purchase.currency,
    bought_at: new Date(purchase.at).toISOString(),
    bundle_id: purchase.bundleId ?? null,
  };
}

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

/**
 * The tally after a pull: the account's purchases for this show, plus this device's purchases still waiting
 * to be sent. A purchase that was synced before but is gone from the account (undone on another device) is
 * dropped, unless it was sent in this very sync (`justSent`: a read can lag the write); one with a removal
 * still queued stays out.
 */
export function reconcileShowSession(
  session: ShowSession,
  remote: readonly ShowPurchase[],
  queue: readonly ShowPurchaseOp[],
  since: number,
  justSent: ReadonlySet<string> = new Set(),
): ShowSession {
  const unsent = new Set([...queue.filter((op) => op.op === 'add').map(opId), ...justSent]);
  const removing = new Set(queue.filter((op) => op.op === 'remove').map(opId));
  const remoteIds = new Set(remote.map((purchase) => purchase.id));
  const byId = new Map<string, ShowPurchase>();
  for (const purchase of session.purchases) {
    if (removing.has(purchase.id)) continue;
    if (purchase.at >= since && !unsent.has(purchase.id) && !remoteIds.has(purchase.id)) continue;
    byId.set(purchase.id, purchase);
  }
  for (const purchase of remote) {
    if (purchase.at < since || removing.has(purchase.id) || byId.has(purchase.id)) continue;
    byId.set(purchase.id, purchase);
  }
  const purchases = [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const earliest = purchases[0]?.at;
  const startedAt =
    earliest === undefined
      ? session.startedAt
      : session.purchases.length === 0
        ? earliest
        : Math.min(session.startedAt, earliest);
  return { ...session, startedAt, purchases };
}

export const sameShowPurchases = (a: ShowSession, b: ShowSession) =>
  a.startedAt === b.startedAt &&
  a.purchases.length === b.purchases.length &&
  a.purchases.every((purchase, index) => purchase.id === b.purchases[index].id);

/** The account side, so the sync can be tested without Supabase. Each call throws on failure. */
export interface ShowPurchaseRemote {
  insert(rows: ShowPurchaseRow[]): Promise<void>;
  remove(clientIds: string[]): Promise<void>;
  listSince(sinceIso: string): Promise<Array<Partial<Record<keyof ShowPurchaseRow, unknown>>>>;
}

export interface ShowPurchaseStore {
  readQueue(): ShowPurchaseOp[];
  writeQueue(queue: ShowPurchaseOp[]): void;
  readSession(now: number): ShowSession;
  writeSession(session: ShowSession): void;
}

export interface ShowPurchaseSyncResult {
  pushed: number;
  removed: number;
  pulled: number;
  changed: boolean;
}

/**
 * Push the queue, then pull this show's purchases. A failed push keeps the queue for the next try (and skips
 * the pull, so nothing unsent is dropped); a failed pull leaves the tally as it is.
 */
export async function syncShowPurchases({
  remote,
  store,
  ownerUserId,
  now = Date.now(),
}: {
  remote: ShowPurchaseRemote;
  store: ShowPurchaseStore;
  ownerUserId: string;
  now?: number;
}): Promise<ShowPurchaseSyncResult> {
  const sent = store.readQueue();
  const adds = sent.flatMap((op) => (op.op === 'add' ? [op.purchase] : []));
  const removals = [...new Set(sent.flatMap((op) => (op.op === 'remove' ? [op.id] : [])))];
  if (adds.length > 0) await remote.insert(adds.map((purchase) => toShowPurchaseRow(purchase, ownerUserId)));
  if (removals.length > 0) await remote.remove(removals);
  if (sent.length > 0) store.writeQueue(withoutSentOps(store.readQueue(), sent));

  const since = showSyncWindowStart(store.readSession(now), now);
  const rows = await remote.listSince(new Date(since).toISOString());
  const pulled = rows.map(fromShowPurchaseRow).filter((purchase): purchase is ShowPurchase => purchase !== null);
  // Re-read: a purchase may have been logged while the requests were in flight.
  const session = store.readSession(now);
  const next = reconcileShowSession(
    session,
    pulled,
    store.readQueue(),
    since,
    new Set(adds.map((purchase) => purchase.id)),
  );
  const changed = !sameShowPurchases(session, next);
  if (changed) store.writeSession(next);
  return { pushed: adds.length, removed: removals.length, pulled: pulled.length, changed };
}
