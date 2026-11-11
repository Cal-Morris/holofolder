"use client"

import { ListFilter } from "lucide-react"
import { SelectorMenu } from "@/components/collection-navigation/selector-menu"
import type { CollectionViewFilter } from "@/lib/collection-view-filter"

const OPTIONS: Array<{ value: CollectionViewFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "owned", label: "Owned" },
  { value: "wanted", label: "Wanted" },
  { value: "needed", label: "Missing" },
]

/** Pocket filter as an icon in the binder toolbar; tinted with a dot while anything but All is shown. */
export function CollectionFilterBar({ value, onChange }: { value: CollectionViewFilter; onChange: (filter: CollectionViewFilter) => void }) {
  const active = value !== "all"
  return <SelectorMenu label="Show pockets" heading="Show" menuLabel="Choose pockets" width={176} className="shrink-0"
    icon={<><ListFilter className={`h-4 w-4 ${active ? "text-primary" : ""}`} aria-hidden />{active && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary" aria-hidden />}</>}
    value={value} valueLabel={OPTIONS.find(option => option.value === value)?.label ?? "All"} options={OPTIONS}
    onSelect={filter => onChange(filter as CollectionViewFilter)} />
}
