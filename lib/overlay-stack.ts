/**
 * Framework-free bookkeeping for stacked overlays (modals, sheets, popovers).
 * Kept separate from the React hook so it can be unit tested.
 */
export interface OverlayEntry {
  id: number
  close: () => void
}

export class OverlayStack {
  private entries: OverlayEntry[] = []
  private nextId = 1
  private listeners = new Set<() => void>()

  push(close: () => void): OverlayEntry {
    const entry = { id: this.nextId++, close }
    this.entries.push(entry)
    this.notify()
    return entry
  }

  remove(id: number) {
    const before = this.entries.length
    this.entries = this.entries.filter((entry) => entry.id !== id)
    if (this.entries.length !== before) this.notify()
  }

  /** Subscribe to open/close changes (for UI that must react to "is any overlay open"). */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    for (const listener of [...this.listeners]) listener()
  }

  update(id: number, close: () => void) {
    const entry = this.entries.find((candidate) => candidate.id === id)
    if (entry) entry.close = close
  }

  top(): OverlayEntry | undefined {
    return this.entries[this.entries.length - 1]
  }

  isTop(id: number) {
    return this.top()?.id === id
  }

  get size() {
    return this.entries.length
  }

  /** Close every open overlay, topmost first. */
  closeAll() {
    for (const entry of [...this.entries].reverse()) {
      entry.close()
    }
  }
}

/** Distance (px) a bottom sheet must be dragged down before release dismisses it. */
export const SWIPE_DISMISS_DISTANCE = 80
/** Downward velocity (px/ms) that dismisses a sheet even on a short flick. */
export const SWIPE_DISMISS_VELOCITY = 0.5

export function shouldDismissSwipe(deltaY: number, elapsedMs: number) {
  if (deltaY <= 0) return false
  if (deltaY >= SWIPE_DISMISS_DISTANCE) return true
  const velocity = deltaY / Math.max(1, elapsedMs)
  return deltaY >= 24 && velocity >= SWIPE_DISMISS_VELOCITY
}
