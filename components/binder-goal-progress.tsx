import { getBinderGoalPresentation } from "@/lib/binder-goals"
import type { BinderSnapshot } from "@/lib/domain/binder-slots"
import type { InventorySnapshot, InventoryCatalogResolver } from "@/lib/domain/inventory"

export function BinderGoalProgress({ inventory, binder, catalog }: { inventory: InventorySnapshot; binder: BinderSnapshot; catalog: InventoryCatalogResolver }) {
  const goal = getBinderGoalPresentation(inventory, binder, catalog)
  return <section aria-label="Current binder progress" className="space-y-1 text-sm">
    <p className="font-semibold">{goal.percentage === null ? "No targets yet" : `${goal.completedTargetCount} of ${goal.targetCount} targets filled · ${goal.percentage}%`}</p>
    {goal.percentage !== null && <progress aria-label="Target completion" value={goal.completedTargetCount} max={goal.targetCount} className="h-2 w-full accent-primary" />}
    <p className="text-xs text-muted-foreground">{goal.assignedCount} assigned copies · {goal.filledFreeSlotCount} of {goal.freeSlotCount} free slots filled</p>
    <p className="text-xs text-muted-foreground">Owner inventory: {goal.ownerCounts.total} copies · {goal.ownerCounts.unassigned} unassigned</p>
    {goal.unknownTargetCount > 0 && <p className="text-xs text-muted-foreground">{goal.unknownTargetCount} assigned targets need catalog evidence to check compatibility.</p>}
  </section>
}
