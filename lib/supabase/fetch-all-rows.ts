/**
 * PostgREST returns at most `max_rows` (1000 on Supabase) rows per request and silently drops the rest, so a
 * plain `select` on a table that can grow past that loses rows. Page with `.range()` until a short page comes
 * back. The query must have a stable, unique `order()` or rows can be skipped or repeated between pages.
 */
export const POSTGREST_MAX_ROWS = 1000;

type RangeResult<T> = { data: T[] | null; error: unknown };

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<RangeResult<T>>,
  pageSize = POSTGREST_MAX_ROWS,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) return { data: rows, error };

    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return { data: rows, error: null };
  }
}
