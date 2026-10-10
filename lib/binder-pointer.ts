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
