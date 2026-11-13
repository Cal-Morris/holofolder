// Read-only lookup across every binder of the collection owner (see docs/multiple-binders.md).
// Per-binder status is unchanged: the open binder still owns its slots. This only answers "is it owned or
// wanted anywhere, and where", for the All binders views and the "Owned in <binder>" hints.
import type { CollectedPokemon } from '@/lib/domain/cards';

export type BinderScope = 'binder' | 'all';
export interface BinderRef {
  id: string;
  name: string;
}

/** Every binder's slots, keyed by binder id (in switcher order). */
export interface AllBindersLookup {
  binders: BinderRef[];
  collections: Map<string, CollectedPokemon[]>;
  loadedBinderIds?: string[];
}

/** "Owned in Trades", "Owned in Trades and Spare", "Owned in Trades +2"; null when none. */
export function formatOwnedIn(binders: readonly BinderRef[], prefix = 'Owned in') {
  if (binders.length === 0) return null;
  if (binders.length === 1) return `${prefix} ${binders[0].name}`;
  if (binders.length === 2) return `${prefix} ${binders[0].name} and ${binders[1].name}`;
  return `${prefix} ${binders[0].name} +${binders.length - 1}`;
}

const SCOPE_KEY_PREFIX = 'binderdex:binder-scope:';

/** The This binder / All binders choice, remembered per view on this device. */
export function readBinderScope(view: 'analytics' | 'wanted'): BinderScope {
  try {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SCOPE_KEY_PREFIX + view) : null;
    return saved === 'all' || (saved === null && view === 'wanted') ? 'all' : 'binder';
  } catch {
    return view === 'wanted' ? 'all' : 'binder';
  }
}

export function rememberBinderScope(view: 'analytics' | 'wanted', scope: BinderScope) {
  try {
    window.localStorage.setItem(SCOPE_KEY_PREFIX + view, scope);
  } catch {
    // Storage blocked: the choice applies for this visit.
  }
}
