import { createHash } from 'node:crypto';
import { DeveloperAccessError } from './permissions';
function queryHash(params: URLSearchParams) {
  const entries = [...params.entries()]
    .filter(([k]) => k !== 'cursor')
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 24);
}
export function encodeCursor(after: string, params: URLSearchParams) {
  return Buffer.from(JSON.stringify({ after, query: queryHash(params) })).toString('base64url');
}
export function decodePage(params: URLSearchParams): { limit: number; after: string | null } {
  const invalid = () =>
    new DeveloperAccessError('invalid_pagination', 'Use a limit from 1 to 100 and a cursor from the same query.', 400);
  const raw = params.get('limit') ?? '50',
    limit = Number(raw);
  if (!/^\d{1,3}$/.test(raw) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw invalid();
  const cursor = params.get('cursor');
  if (!cursor) return { limit, after: null };
  if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw invalid();
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed.after !== 'string' ||
      parsed.after.length > 200 ||
      !parsed.after ||
      parsed.query !== queryHash(params)
    )
      throw invalid();
    return { limit, after: parsed.after };
  } catch {
    throw invalid();
  }
}

export function paginateEntries<T>(entries: readonly T[], params: URLSearchParams, key: (entry: T) => string) {
  const page = decodePage(params);
  const compare = (a: string, b: string) => a.localeCompare(b, 'en');
  const sorted = entries.toSorted((a, b) => compare(key(a), key(b)));
  const visible = sorted.filter((row) => !page.after || compare(key(row), page.after) > 0).slice(0, page.limit + 1);
  return {
    data: visible.slice(0, page.limit),
    nextCursor: visible.length > page.limit ? encodeCursor(key(visible[page.limit - 1]), params) : null,
  };
}
