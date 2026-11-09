/** Opaque private migration evidence, never catalog truth or a public projection. */
export type InventorySource = null | boolean | number | string | InventorySource[] | { [key: string]: InventorySource }
export function normalizeInventorySource(value: unknown): InventorySource | undefined {
  let budget = 10000
  function copy(v: unknown, depth: number): InventorySource | undefined {
    if (--budget < 0 || depth > 30) return undefined
    if (v === null || typeof v === "boolean" || typeof v === "string") return v
    if (typeof v === "number") return Number.isFinite(v) ? v : undefined
    if (!v || typeof v !== "object" || Object.getPrototypeOf(v) !== Object.prototype && !Array.isArray(v)) return undefined
    if (Array.isArray(v)) {
      const values = Array.from(v, x => copy(x, depth + 1))
      return values.some(x => x === undefined) ? undefined : values as InventorySource[]
    }
    const entries = Object.entries(v).map(([k, x]) => [k, copy(x, depth + 1)] as const)
    return entries.some(([, x]) => x === undefined) ? undefined : Object.fromEntries(entries) as InventorySource
  }
  return copy(value, 0)
}
