/** Safe presentation model for committed history, separate from the local undo queue. */
import type {
  ActivityState,
  ActivityChange,
  ActivityEvent,
  ActivityPage,
  ActivityScope,
} from '@/lib/domain/collection-activity';
export type {
  ActivityState,
  ActivityChange,
  ActivityEvent,
  ActivityPage,
  ActivityScope,
} from '@/lib/domain/collection-activity';
// The only row fields Activity shows. Everything else (certificates, labels, artwork) is dropped.
const stateFields = new Set([
  'id',
  'card_id',
  'card_name',
  'card_set',
  'card_language',
  'card_finish',
  'status',
  'grade',
  'grading_company',
  'grade_value',
  'condition',
  'name',
  'binder_id',
  'collection_id',
  'inventory_item_id',
  'slot_id',
  'target',
  'target_kind',
  'target_id',
  'sort_order',
  'position',
  'page',
  'row',
  'column',
  'slot_index',
  'wanted_cards',
  'wanted_by',
  'is_default',
  'rows',
  'cols',
  'storage_version',
  'layout_version',
  'version',
  'quantity',
  'favorite',
  'collected_at',
  'removed_at',
  'language',
  'finish',
  'kind',
  'identity',
  'grading',
  'cardId',
  'pokemonId',
  'catalogId',
  'company',
  'value',
  'scale',
  'is_enabled',
  'show_prices',
  'storage_authority',
  'layout',
  'inventory_revision',
  'provider',
  'designation',
  'subgrades',
  'holder',
]);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function safeState(v: unknown, depth = 0): ActivityState | null {
  if (!record(v) || depth > 3) return null;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => stateFields.has(k))
      .map(([k, value]) => [
        k,
        Array.isArray(value)
          ? value.map((x) =>
              record(x) ? safeState(x, depth + 1) : typeof x === 'string' || typeof x === 'number' ? x : null,
            )
          : record(value)
            ? safeState(value, depth + 1)
            : value === null || ['string', 'number', 'boolean'].includes(typeof value)
              ? value
              : null,
      ]),
  );
}
/** Stored audit changes, reduced to the fields Activity shows. */
export function projectActivityChanges(value: unknown): ActivityChange[] {
  return Array.isArray(value)
    ? value.filter(record).map((c) => ({
        table: typeof c.table === 'string' ? c.table : 'unknown',
        id: typeof c.id === 'string' ? c.id : '',
        before: safeState(c.before),
        after: safeState(c.after),
      }))
    : [];
}
export function parseActivityPage(value: unknown): ActivityPage | null {
  if (
    !record(value) ||
    !Array.isArray(value.data) ||
    !(value.nextCursor === null || typeof value.nextCursor === 'string')
  )
    return null;
  const data: ActivityEvent[] = [];
  for (const row of value.data) {
    if (
      !record(row) ||
      typeof row.id !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(row.id) ||
      BigInt(row.id) > BigInt('9223372036854775807') ||
      typeof row.recorded_at !== 'string'
    )
      return null;
    const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : null);
    const affected: Record<string, string[]> = {};
    if (record(row.affected_entities))
      for (const key of ['collectionIds', 'inventoryItemIds', 'slotIds']) {
        const ids = row.affected_entities[key];
        if (Array.isArray(ids)) affected[key] = ids.filter((id): id is string => typeof id === 'string');
      }
    data.push({
      id: row.id,
      recorded_at: row.recorded_at,
      format_version: typeof row.format_version === 'number' ? row.format_version : 0,
      actor_kind: text('actor_kind') ?? 'unknown',
      actor_user_id: text('actor_user_id'),
      actor_job: text('actor_job'),
      source: text('source') ?? 'unknown',
      client_id: text('client_id'),
      action: text('action') ?? 'collection_change',
      operation_id: text('operation_id'),
      batch_id: text('batch_id'),
      client_occurred_at: text('client_occurred_at'),
      recovery_of_event_id: text('recovery_of_event_id'),
      affected_entities: affected,
      changes: projectActivityChanges(row.changes),
    });
  }
  return { data, nextCursor: value.nextCursor };
}
export function activityActor(
  event: Pick<ActivityEvent, 'actor_kind' | 'actor_job' | 'actor_user_id'>,
  accountId?: string,
  memberIds: readonly string[] = [],
) {
  if (event.actor_kind === 'system') return event.actor_job ? `System · ${event.actor_job}` : 'System';
  if (event.actor_kind === 'user' && event.actor_user_id) {
    if (event.actor_user_id === accountId) return 'You';
    if (memberIds.includes(event.actor_user_id)) return 'Collection partner';
    return `Account ${event.actor_user_id}`;
  }
  return 'Unknown';
}
export function activitySource(source: string) {
  return (
    (
      {
        app: 'Website',
        rest: 'REST API',
        mcp: 'MCP',
        direct: 'Direct database',
        system: 'System',
        import: 'Import',
        unknown: 'Unknown',
      } as Record<string, string>
    )[source] ?? source
  );
}
export function activityTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown server time'
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
}
export function activityEntityName(event: Pick<ActivityEvent, 'changes'>) {
  const state = event.changes[0]?.after ?? event.changes[0]?.before;
  const identity = record(state?.identity) ? state.identity : record(state?.target) ? state.target : null;
  return state?.card_name ?? state?.name ?? state?.card_id ?? identity?.cardId ?? null;
}
export function activityEntityKind(table: string) {
  return (
    (
      {
        inventory_items: 'Owned item',
        inventory_placements: 'Placement',
        binder_slots: 'Slot',
        binders: 'Collection',
        user_settings: 'Settings',
        binder_appearances: 'Appearance',
        binder_shares: 'Sharing',
      } as Record<string, string>
    )[table] ?? 'Recorded entity'
  );
}
const labels: Record<string, string> = {
  is_default: 'Default collection',
  card_id: 'Card printing',
  card_name: 'Card name',
  card_set: 'Set',
  card_finish: 'Finish',
  card_language: 'Language',
  status: 'Ownership / wanted status',
  wanted_cards: 'Wanted cards',
  grade: 'Grade',
  grading_company: 'Grading company',
  slot_id: 'Slot',
  binder_id: 'Collection',
  collection_id: 'Collection',
  inventory_item_id: 'Owned item',
  target: 'Target',
  sort_order: 'Order',
  position: 'Position',
  slot_index: 'Slot order',
};
function display(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (Array.isArray(value)) return value.length ? value.map(display).join(', ') : 'None';
  if (record(value))
    return Object.entries(value)
      .map(([k, v]) => `${labels[k] ?? k.replaceAll('_', ' ')}: ${display(v)}`)
      .join(', ');
  return String(value);
}
export function activityChanges(event: Pick<ActivityEvent, 'changes'>) {
  const changes = event.changes;
  const removedItems = new Set(changes.filter((c) => c.table === 'inventory_items' && !c.after).map((c) => c.id));
  return changes.map((change) => {
    const state = change.after ?? change.before;
    const name = String(
      state?.card_name ??
        state?.name ??
        state?.card_id ??
        (record(state?.identity) ? state.identity.cardId : undefined) ??
        change.id ??
        'Recorded change',
    );
    const verb =
      change.table === 'inventory_items'
        ? !change.after
          ? 'Ownership removed'
          : !change.before
            ? 'Ownership added'
            : 'Owned item edited'
        : change.table === 'inventory_placements'
          ? !change.after
            ? removedItems.has(String(change.before?.inventory_item_id ?? change.id))
              ? 'Placement removed with ownership'
              : 'Unassigned, ownership retained'
            : !change.before
              ? 'Assigned'
              : 'Moved'
          : change.table === 'binder_slots'
            ? !change.after
              ? 'Slot removed'
              : !change.before
                ? 'Slot added'
                : 'Slot / target changed'
            : change.table === 'binders'
              ? !change.after
                ? 'Collection deleted'
                : !change.before
                  ? 'Collection created'
                  : 'Collection changed'
              : 'Metadata changed';
    const keys = [...new Set([...Object.keys(change.before ?? {}), ...Object.keys(change.after ?? {})])].filter(
      (key) => key !== 'id',
    );
    return {
      ...change,
      title: `${verb} · ${name}`,
      fields: keys
        .filter((key) => JSON.stringify(change.before?.[key]) !== JSON.stringify(change.after?.[key]))
        .map((key) => ({
          label: labels[key] ?? key.replaceAll('_', ' '),
          before: display(change.before?.[key]),
          after: display(change.after?.[key]),
        })),
    };
  });
}
export const ACTIVITY_SCOPE_KEY = 'holofolder_activity_scope_v1';
const CACHE_KEY = 'holofolder_activity_cache_v1';
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const activityCacheKey = (scope: ActivityScope, query: string) =>
  JSON.stringify([scope.accountId, scope.ownerId, scope.membershipKey, query]);
export function sameActivityScope(a: ActivityScope | null, b: ActivityScope | null) {
  return !!a && !!b && a.accountId === b.accountId && a.ownerId === b.ownerId && a.membershipKey === b.membershipKey;
}
export function normalizeActivityScope(value: unknown): ActivityScope | null {
  if (
    !record(value) ||
    typeof value.accountId !== 'string' ||
    typeof value.ownerId !== 'string' ||
    typeof value.membershipKey !== 'string'
  )
    return null;
  if (
    value.memberIds !== undefined &&
    (!Array.isArray(value.memberIds) ||
      value.memberIds.length > 2 ||
      !value.memberIds.every((id) => typeof id === 'string'))
  )
    return null;
  return {
    accountId: value.accountId,
    ownerId: value.ownerId,
    membershipKey: value.membershipKey,
    ...(Array.isArray(value.memberIds) ? { memberIds: [...value.memberIds] } : {}),
  };
}
export function storedActivityScope(storage: Storage): ActivityScope | null {
  try {
    return normalizeActivityScope(JSON.parse(storage.getItem(ACTIVITY_SCOPE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
export function clearActivityCache(storage: Storage) {
  try {
    storage.removeItem(ACTIVITY_SCOPE_KEY);
    storage.removeItem(CACHE_KEY);
  } catch {
    /* Private storage may be unavailable. */
  }
}
export function readActivityCache(
  storage: Storage,
  scope: ActivityScope,
  key: string,
): { page: ActivityPage; syncedAt: string } | null {
  try {
    if (!sameActivityScope(storedActivityScope(storage), scope)) return null;
    const value = JSON.parse(storage.getItem(CACHE_KEY) ?? '{}')[key];
    const page = parseActivityPage(value?.page);
    return page && typeof value.syncedAt === 'string' ? { page, syncedAt: value.syncedAt } : null;
  } catch {
    return null;
  }
}
export function writeActivityCache(
  storage: Storage,
  scope: ActivityScope,
  key: string,
  page: ActivityPage,
  syncedAt: string,
) {
  try {
    if (!sameActivityScope(storedActivityScope(storage), scope)) return false;
    const entries = JSON.parse(storage.getItem(CACHE_KEY) ?? '{}');
    // Keep at most eight exact query pages. Never imply this is a complete owner history.
    const next = Object.fromEntries(
      Object.entries(entries)
        .filter(([k]) => k !== key)
        .slice(-7),
    );
    next[key] = { page: parseActivityPage(page), syncedAt };
    storage.setItem(CACHE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
