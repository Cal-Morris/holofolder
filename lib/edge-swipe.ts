/**
 * Framework-free rules for the edge swipe-back gesture (standalone PWA has no browser back
 * gesture): start at the left screen edge, travel mostly sideways, and either go far
 * enough or flick fast enough. Kept separate from the hook so it can be unit tested.
 */
/** Width (px) of the left-edge zone where a back swipe may start. */
export const EDGE_SWIPE_ZONE = 24
/** Horizontal travel (px) that commits the back navigation on release. */
export const EDGE_SWIPE_DISTANCE = 72
/** Rightward release speed (px/ms) that commits a shorter flick. */
export const EDGE_SWIPE_VELOCITY = 0.45
/** Travel (px) before the gesture decides between sideways (back) and vertical (scroll). */
export const EDGE_SWIPE_SLOP = 10

export function isEdgeStart(x: number, zone = EDGE_SWIPE_ZONE) {
  return x >= 0 && x <= zone
}

/** "back" once clearly sideways, "cancel" once clearly vertical or leftward, otherwise undecided. */
export function classifyEdgeDrag(dx: number, dy: number): "back" | "cancel" | "pending" {
  if (Math.hypot(dx, dy) < EDGE_SWIPE_SLOP) return "pending"
  if (dx > 0 && Math.abs(dx) > Math.abs(dy) * 1.2) return "back"
  return "cancel"
}

export function shouldCommitEdgeSwipe(dx: number, velocity: number) {
  if (dx <= 0) return false
  if (dx >= EDGE_SWIPE_DISTANCE) return velocity > -0.2
  return dx >= 28 && velocity >= EDGE_SWIPE_VELOCITY
}

/** 0–1 feedback progress for the edge indicator. */
export function edgeSwipeProgress(dx: number) {
  return Math.max(0, Math.min(1, dx / EDGE_SWIPE_DISTANCE))
}

/** Remembers the views visited so back (swipe or Cmd+[) and forward (Cmd+]) can move between them. */
export class ViewBackStack<View extends string> {
  private stack: View[] = []
  private forwardStack: View[] = []
  private returning: View | null = null

  constructor(private limit = 10) {}

  /** Record a view change; changes made by `back()` or `forward()` do not grow the stack. */
  visit(previous: View, next: View) {
    if (previous === next) return
    if (this.returning === next) {
      this.returning = null
      return
    }
    this.returning = null
    this.forwardStack = []
    this.stack.push(previous)
    if (this.stack.length > this.limit) this.stack.shift()
  }

  peek(): View | undefined {
    return this.stack.at(-1)
  }

  /** Pop the previous view, remember `current` for forward, and mark the coming change as a return. */
  back(current: View): View | undefined {
    const view = this.stack.pop()
    if (view !== undefined) this.forwardStack.push(current)
    this.returning = view ?? null
    return view
  }

  /** Undo the last `back()`. */
  forward(current: View): View | undefined {
    const view = this.forwardStack.pop()
    if (view !== undefined) this.stack.push(current)
    this.returning = view ?? null
    return view
  }
}
