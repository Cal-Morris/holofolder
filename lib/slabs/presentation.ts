import type { GradingRecord } from "@/lib/domain/inventory"
import type { InventoryBrowseRow } from "@/lib/domain/inventory-browse"
import { parseTcgdexCardImageUrl } from "@/lib/tcgdex-card-image"
import { parseSourceCardImageUrl } from "@/lib/card-image-sources"

/** Explicit recorded versions only. These are presentation keys, never grading rules. */
export const SLAB_STYLES = {
  "psa-lighthouse": { provider: "psa", holders: ["psa-standard"], name: "PSA LightHouse" },
  "cgc-current": { provider: "cgc", holders: ["cgc-2025", "cgc-2023"], name: "CGC Cards" },
  "cgc-pristine": { provider: "cgc", holders: ["cgc-2025", "cgc-2023"], name: "CGC Cards Pristine" },
  "cgc-blue": { provider: "cgc", holders: ["cgc-2020"], name: "CGC Trading Cards blue" },
  "beckett-silver": { provider: "beckett", holders: ["beckett-standard"], name: "Beckett Silver" },
  "beckett-gold": { provider: "beckett", holders: ["beckett-standard"], name: "Beckett Gold" },
  "beckett-black": { provider: "beckett", holders: ["beckett-standard"], name: "Beckett Black" },
} as const
export type SlabStyle = keyof typeof SLAB_STYLES | "neutral" | "raw"
/** Safe renderer input. No certificate, record URL, original label/slab photo, asset ID or owner/location. */
export interface SlabPresentation {
  tint: "slate" | "teal" | "rose" | "sand"
  style: SlabStyle
  holder: "psa" | "cgc-2025" | "cgc-2023" | "cgc-2020" | "beckett" | "neutral" | "raw"
  provider: string | null
  grade: string | null
  designation: string | null
  scale: string | null
  subgrades: { name: string; grade: string }[]
  name: string
  set: string | null
  number: string | null
  image: string | null
  note: string | null
}
export function selectSlabStyle(record: GradingRecord | null): SlabStyle {
  if (!record) return "raw"
  const variant = record.label.variant
  if (!variant || !Object.hasOwn(SLAB_STYLES, variant)) return "neutral"
  const support = SLAB_STYLES[variant as keyof typeof SLAB_STYLES]
  if (record.provider.kind !== "known" || record.provider.id !== support.provider
    || !support.holders.some(holder => holder === record.holder)) return "neutral"
  return variant as keyof typeof SLAB_STYLES
}
/** Catalog allowlist, not a general private-asset URL channel. Reject query/credential-bearing URLs. */
export function slabCatalogImage(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null
    return parseTcgdexCardImageUrl(url) || parseSourceCardImageUrl(url)
      || url.origin === "https://assets.holofolder.com" && /^\/cards\/[a-zA-Z0-9/_@.-]+\.(webp|png|jpg)$/.test(url.pathname) ? value : null
  } catch { return null }
}
export function slabPresentation(row: InventoryBrowseRow, record: GradingRecord | null): SlabPresentation {
  const style = selectSlabStyle(record)
  const holder = style === "raw" ? "raw" : style.startsWith("psa-") ? "psa" : style.startsWith("beckett-") ? "beckett"
    : style.startsWith("cgc-") ? record!.holder as "cgc-2025" | "cgc-2023" | "cgc-2020" : "neutral"
  const tint = record?.provider.kind === "custom" ? ["teal", "rose", "sand"].find(t => record.label.variant === `custom-${t}`) : undefined
  return { tint: (tint ?? "slate") as SlabPresentation["tint"], style, holder, provider: record ? record.provider.kind === "known" ? ({ psa: "PSA", cgc: "CGC", beckett: "Beckett", ace: "ACE" })[record.provider.id] : record.provider.name : null,
    grade: record?.grade ?? null, designation: record?.designation ?? null, scale: record?.scale ?? null,
    subgrades: record?.subgrades.map(s => ({ name: s.name, grade: s.grade })) ?? [],
    name: row.name ?? (row.speciesNames.join(", ") || row.cardId || "Unknown card"), set: row.setName, number: row.number,
    image: slabCatalogImage(row.image), note: style === "neutral" ? record?.provider.kind === "known" && record.provider.id === "ace"
      ? "Exact ACE label artwork unavailable" : "Label appearance unknown or unsupported" : null }
}
export function slabSummary(p: SlabPresentation) {
  return p.style === "raw" ? "Raw · Ungraded" : `${p.provider} · ${p.grade ?? "Grade unknown"}`
}
