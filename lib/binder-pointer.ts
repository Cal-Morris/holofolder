interface PointerPosition { pointerId: number; clientX: number; clientY: number }
export function createBinderTapTracker() {
  const active = new Set<number>()
  let candidate: PointerPosition | null = null
  function move(event: PointerPosition) {
    if (candidate?.pointerId === event.pointerId && Math.hypot(event.clientX - candidate.clientX, event.clientY - candidate.clientY) > 7) candidate = null
  }
  return {
    down(event: PointerPosition) {
      active.add(event.pointerId)
      candidate = active.size === 1 ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY } : null
    },
    move,
    up(event: PointerPosition) {
      move(event)
      active.delete(event.pointerId)
      const tapped = candidate?.pointerId === event.pointerId && active.size === 0
      candidate = null
      return tapped
    },
    cancel(event: PointerPosition) { active.delete(event.pointerId); candidate = null },
  }
}

export function createBinderSwipeTracker() {
  const active = new Set<number>()
  let start: PointerPosition | null = null
  return {
    down(event: PointerPosition, enabled: boolean) {
      active.add(event.pointerId)
      start = enabled && active.size === 1 ? { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY } : null
    },
    up(event: PointerPosition): -1 | 1 | null {
      active.delete(event.pointerId)
      const origin = start
      start = null
      if (!origin || origin.pointerId !== event.pointerId || active.size) return null
      const dx = event.clientX - origin.clientX, dy = event.clientY - origin.clientY
      return Math.abs(dx) >= 45 && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 1 : -1) : null
    },
    cancel(event: PointerPosition) { active.delete(event.pointerId); start = null },
  }
}
