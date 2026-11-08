import type { BinderSettings } from "@/lib/settings"

export const MAX_BINDER_GRID_SIZE = 8
export const BINDER_SIZES = [
  { rows: 1, cols: 1, label: "1x1" },
  { rows: 2, cols: 2, label: "2x2" },
  { rows: 3, cols: 3, label: "3x3" },
  { rows: 3, cols: 4, label: "3x4" },
  { rows: 4, cols: 3, label: "4x3" },
  { rows: 4, cols: 4, label: "4x4" },
] as const

export function isBinderGridSize(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_BINDER_GRID_SIZE
}
export function isPresetBinderLayout(rows: number, cols: number) {
  return BINDER_SIZES.some(size => size.rows === rows && size.cols === cols)
}
export function needsCustomLayoutAccess(next: { rows: number; cols: number }, previous: { rows: number | null; cols: number | null } | null) {
  return !isPresetBinderLayout(next.rows, next.cols) && (next.rows !== previous?.rows || next.cols !== previous?.cols)
}
export function withBinderLayout(settings: BinderSettings, binder: { rows: number | null; cols: number | null } | null | undefined): BinderSettings {
  return { ...settings, binderRows: isBinderGridSize(binder?.rows) ? binder.rows : settings.binderRows, binderCols: isBinderGridSize(binder?.cols) ? binder.cols : settings.binderCols }
}
