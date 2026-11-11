/**
 * Remembers how far each main view (List, Sets, Wanted…) was scrolled, in memory and in
 * sessionStorage so positions survive leaving the page and coming back with back/forward.
 * Framework-free so it can be unit tested.
 */
export const VIEW_SCROLL_STORAGE_KEY = 'binderdex:view-scroll';

export interface ScrollStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class ViewScrollMemory {
  private positions = new Map<string, number>();
  private loaded = false;

  constructor(
    private storage: () => ScrollStore | null,
    private scope = '',
  ) {}

  private key(view: string) {
    return `${this.scope}|${view}`;
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = this.storage()?.getItem(VIEW_SCROLL_STORAGE_KEY);
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) this.positions.set(key, value);
      }
    } catch {
      // Corrupt or unavailable storage: start fresh.
    }
  }

  get(view: string): number {
    this.load();
    return this.positions.get(this.key(view)) ?? 0;
  }

  set(view: string, top: number) {
    this.load();
    const value = Math.max(0, Math.round(top));
    if (value === 0) this.positions.delete(this.key(view));
    else this.positions.set(this.key(view), value);
    try {
      this.storage()?.setItem(VIEW_SCROLL_STORAGE_KEY, JSON.stringify(Object.fromEntries(this.positions)));
    } catch {
      // Quota or private mode: in-memory restore still works for this session.
    }
  }
}

/** Scroll position to apply now, given what the scroller can currently reach. */
export function reachableScrollTop(target: number, scrollHeight: number, clientHeight: number) {
  return Math.max(0, Math.min(target, scrollHeight - clientHeight));
}
