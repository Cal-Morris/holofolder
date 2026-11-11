import { binderPath, parseBinderPath } from '@/lib/binders/url';
import {
  ACTIVE_BINDER_COOKIE,
  BINDER_GRID_COOKIE,
  isBinderId,
  parseBinderGrid,
  type Binder,
} from '@/lib/binders/model';

export type BinderWithCount = Binder & { slotCount: number };

const LAST_BINDER_STORAGE_KEY = 'binderdex:last-binder';
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

/** Remember the binder this device opened last (the cookie lets the server render it first). */
export function rememberLastOpenedBinder(binderId: string | null) {
  if (typeof document === 'undefined' || !isBinderId(binderId)) return;
  document.cookie = `${ACTIVE_BINDER_COOKIE}=${binderId}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
  try {
    window.localStorage.setItem(LAST_BINDER_STORAGE_KEY, binderId);
  } catch {
    // Storage can be full or disabled; the cookie is enough.
  }
}

/** Remember the page grid of the binder on screen, so the next start's skeleton has the same pockets. */
export function rememberBinderGrid(rows: number, cols: number) {
  const value = `${rows}x${cols}`;
  if (typeof document === 'undefined' || !parseBinderGrid(value)) return;
  document.cookie = `${BINDER_GRID_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

export function readLastOpenedBinder(): string | null {
  try {
    const value = typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_BINDER_STORAGE_KEY);
    return isBinderId(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * The router destination that opens one binder: /<slug> when it has one, else the current page with ?binder= set.
 * Other query parameters are kept.
 */
export function binderHref(binderId: string, currentHref?: string, slug?: string | null) {
  const url = new URL(currentHref ?? 'http://app.invalid/');
  const pathname = url.pathname.replace(/^\/app(?=\/|$)/, '') || '/';
  if (slug && (pathname === '/' || parseBinderPath(pathname))) {
    for (const param of ['binder', 'view', 'page']) url.searchParams.delete(param);
    return `${binderPath(slug)}${url.search}`;
  }
  if (parseBinderPath(pathname)) return `/?binder=${encodeURIComponent(binderId)}`;
  url.searchParams.set('binder', binderId);
  return `${pathname}${url.search}`;
}

export class BinderRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason?: string,
    readonly slotCount?: number,
  ) {
    super(message);
    this.name = 'BinderRequestError';
  }
}

async function request(init: RequestInit & { query?: string } = {}) {
  const { query, ...rest } = init;
  const response = await fetch(`/app/api/binders${query ?? ''}`, {
    cache: 'no-store',
    ...rest,
    headers: rest.body ? { 'Content-Type': 'application/json', ...rest.headers } : rest.headers,
  });
  const payload = (await response.json().catch(() => null)) as {
    binders?: BinderWithCount[];
    error?: string;
    reason?: string;
    code?: string;
    slotCount?: number;
    createdBinderId?: string;
  } | null;
  if (!response.ok || !payload?.binders) {
    throw new BinderRequestError(
      payload?.error || `Binder request failed (${response.status})`,
      response.status,
      payload?.reason ?? payload?.code,
      payload?.slotCount,
    );
  }
  return payload as { binders: BinderWithCount[]; createdBinderId?: string };
}

export const bindersApi = {
  list: () => request(),
  create: (name: string) => request({ method: 'POST', body: JSON.stringify({ name }) }),
  rename: (id: string, name: string) => request({ method: 'PATCH', body: JSON.stringify({ id, name }) }),
  reorder: (order: string[]) => request({ method: 'PATCH', body: JSON.stringify({ order }) }),
  remove: (id: string, confirmed: boolean) =>
    request({ method: 'DELETE', query: `?id=${encodeURIComponent(id)}${confirmed ? '&confirm=1' : ''}` }),
};
