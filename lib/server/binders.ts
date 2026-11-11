import type { SupabaseClient } from '@supabase/supabase-js';
import { matchBinder } from '@/lib/binders/url';
import { bindersFromRows, isBinderId, pickActiveBinder, type Binder } from '@/lib/binders/model';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>;

const BINDER_COLUMNS =
  'id, owner_user_id, name, color, sort_order, is_default, binder_rows, binder_cols, created_at, updated_at';

/** Table missing (migration 039 not applied): callers fall back to the single-binder behaviour. */
export function isMissingBindersError(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false;
  return (
    error.code === '42P01' ||
    error.code === 'PGRST205' ||
    error.code === '42703' ||
    (/binders|binder_id/.test(error.message ?? '') && /does not exist|schema cache/.test(error.message ?? ''))
  );
}

/** The owner's binders in switcher order; [] when the table isn't there yet. Pass the caller's client so RLS applies. */
export async function listOwnerBinders(client: AnySupabaseClient, ownerUserId: string): Promise<Binder[]> {
  const read = (columns: string) =>
    client
      .from('binders')
      .select(columns)
      .eq('owner_user_id', ownerUserId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
  let { data, error } = await read(`${BINDER_COLUMNS}, slug:binder_slug`);
  // Before migration 106 there is no binder_slug: binders open by ?binder=<id>.
  if (error && /binder_slug/.test(error.message ?? '')) ({ data, error } = await read(BINDER_COLUMNS));
  if (error) {
    if (isMissingBindersError(error)) return [];
    throw error;
  }
  return bindersFromRows(data as unknown as Record<string, unknown>[]);
}

/** Service role: the owner's default binder id, created if missing (migration 039's ensure_default_binder). */
export async function ensureDefaultBinderId(admin: AnySupabaseClient, ownerUserId: string): Promise<string | null> {
  const { data, error } = await admin.rpc('ensure_default_binder', { owner: ownerUserId });
  if (error) {
    if (isMissingBindersError(error) || error.code === 'PGRST202') return null;
    throw error;
  }
  return isBinderId(data) ? data : null;
}

export class BinderAccessError extends Error {
  constructor() {
    super('Binder not found');
    this.name = 'BinderAccessError';
  }
}

/**
 * The binder a collection write targets. A requested id must belong to the owner (BinderAccessError otherwise);
 * no id means the owner's default. Null only before migration 039, when rows are scoped by owner alone.
 */
export async function resolveWriteBinderId(
  admin: AnySupabaseClient,
  ownerUserId: string,
  requestedBinderId: unknown,
): Promise<string | null> {
  if (requestedBinderId === undefined || requestedBinderId === null || requestedBinderId === '') {
    return ensureDefaultBinderId(admin, ownerUserId);
  }
  if (!isBinderId(requestedBinderId)) throw new BinderAccessError();
  const { data, error } = await admin
    .from('binders')
    .select('id')
    .eq('id', requestedBinderId)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();
  if (error) {
    if (isMissingBindersError(error)) return null;
    throw error;
  }
  if (!data) throw new BinderAccessError();
  return requestedBinderId;
}

/** Binder list plus the one to open, for the page bootstrap. */
export async function resolveActiveBinder(
  client: AnySupabaseClient,
  ownerUserId: string,
  requestedId?: string | null,
  lastOpenedId?: string | null,
) {
  const binders = await listOwnerBinders(client, ownerUserId).catch((error) => {
    console.error('[holofolder] Failed to list binders:', error);
    return [] as Binder[];
  });
  // A slug (from /<slug>/binder/<page>) names a binder as well as its id does.
  const requested = requestedId ? (matchBinder(binders, requestedId)?.id ?? requestedId) : null;
  return { binders, activeBinder: pickActiveBinder(binders, requested, lastOpenedId) };
}
