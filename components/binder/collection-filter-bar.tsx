"use client"

import type { CollectionViewFilter } from "@/lib/collection-view-filter"

const OPTIONS: Array<{ id: CollectionViewFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "owned", label: "Owned" },
  { id: "wanted", label: "Wanted" },
  { id: "needed", label: "Missing" },
]

/** Compact segmented filter above the binder grid. Equal-width segments so it never overflows at 375px. */
export function CollectionFilterBar({ value, onChange }: { value: CollectionViewFilter; onChange: (filter: CollectionViewFilter) => void }) {
  return <div role="group" aria-label="Show pockets" className="mx-3 flex shrink-0 gap-0.5 rounded-full border border-border/55 bg-card/70 p-0.5 sm:mx-4 sm:max-w-sm md:mx-7">
    {OPTIONS.map(option => <button key={option.id} type="button" aria-pressed={value === option.id} onClick={() => onChange(option.id)}
      className={`min-h-9 min-w-0 flex-1 rounded-full px-2 text-xs font-semibold transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] ${value === option.id ? "holo-selected text-primary" : "text-muted-foreground hover:text-foreground"}`}>
      {option.label}
    </button>)}
  </div>
}
