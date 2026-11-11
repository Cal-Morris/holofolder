import { MAX_BINDERS_PER_OWNER, sortBinders, type Binder } from '@/lib/binders/model';

export type BinderDeletePlan =
  | { ok: true; promoteBinderId: string | null }
  | { ok: false; reason: 'not-found' | 'last-binder' | 'needs-confirmation' };

/**
 * Whether a binder may be deleted. The last binder never can; one with slots needs explicit confirmation.
 * Deleting the default promotes the first remaining binder in switcher order.
 */
export function planBinderDelete(
  binders: readonly Binder[],
  binderId: string,
  slotCount: number,
  confirmed: boolean,
): BinderDeletePlan {
  const target = binders.find((binder) => binder.id === binderId);
  if (!target) return { ok: false, reason: 'not-found' };
  if (binders.length <= 1) return { ok: false, reason: 'last-binder' };
  if (slotCount > 0 && !confirmed) return { ok: false, reason: 'needs-confirmation' };
  const promote = target.isDefault
    ? (sortBinders(binders.filter((binder) => binder.id !== binderId))[0]?.id ?? null)
    : null;
  return { ok: true, promoteBinderId: promote };
}

export function canCreateBinder(binders: readonly Binder[]) {
  return binders.length < MAX_BINDERS_PER_OWNER;
}

/** A new order must name every binder exactly once; returns the ids in order, or null. */
export function validateBinderOrder(binders: readonly Binder[], order: unknown): string[] | null {
  if (!Array.isArray(order) || order.length !== binders.length) return null;
  const known = new Set(binders.map((binder) => binder.id));
  const seen = new Set<string>();
  for (const id of order) {
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return null;
    seen.add(id);
  }
  return order as string[];
}

/** Move one binder up or down in a list (switcher reorder buttons). */
export function moveBinder(binders: readonly Binder[], binderId: string, direction: -1 | 1): Binder[] {
  const list = [...binders];
  const index = list.findIndex((binder) => binder.id === binderId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list.map((binder, sortOrder) => ({ ...binder, sortOrder }));
}
