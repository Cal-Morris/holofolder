import { normalizeGradingRecord, normalizeInventoryItem } from "@/lib/domain/inventory"
import type { GradingRecord, InventoryItem } from "@/lib/domain/inventory"
import type { InventoryCommand, InventoryItemRef } from "@/lib/domain/inventory-commands"

export type GradingEditCommand = Extract<InventoryCommand, { kind: "edit" }>
/** A queued/optimistic result is deliberately not an accepted persistence receipt. */
export type GradingCommitResult = { kind: "persisted" } | { kind: "rejected"; message: string }

export function emptyGradingRecord(): GradingRecord {
  return { provider: { kind: "known", id: "psa" }, grade: null, scale: null, designation: null,
    subgrades: [], certificate: null, holder: null, label: { variant: null, assetIds: [] } }
}

/** Keep the supplied optimistic concurrency predicates. Host supplies the full 075 request/context. */
export function gradingEditCommand(item: InventoryItem, ref: InventoryItemRef, value: unknown): GradingEditCommand {
  const grading = normalizeGradingRecord(value)
  if (!normalizeInventoryItem(item) || grading === undefined || ref.itemId !== item.id || ref.itemVersion !== item.version
    || (item.identity.kind !== "card" && grading !== null)
    || (ref.placement !== null && (ref.placement.slot.inventoryItemId !== item.id || ref.placement.slot.itemVersion !== item.version))) {
    throw new Error("Grading needs a valid draft and the current copy reference")
  }
  return { kind: "edit", item: structuredClone(ref), grading }
}

/** Evidence is supplied for the current owner only; absence is not proof of uniqueness. */
export function duplicateGradingCopies(item: InventoryItem, grading: GradingRecord | null, evidence: readonly InventoryItem[]): string[] {
  if (!grading?.certificate) return []
  const key = (p: GradingRecord["provider"]) => p.kind === "known" ? `known:${p.id}` : `custom:${p.name}`
  return evidence.filter(other => other.id !== item.id && other.ownerUserId === item.ownerUserId
    && other.grading?.certificate === grading.certificate && key(other.grading.provider) === key(grading.provider)).map(other => other.id)
}

/** Advisory only: preserve legacy/text grades, never regrade or infer a label from a number. */
export function gradingReviewNotes(record: GradingRecord | null): string[] {
  if (!record) return []
  const notes: string[] = []
  if (record.grade === null) notes.push("Grade unknown. No numeric grade will be invented.")
  if (record.provider.kind === "known" && record.grade !== null) {
    const grade = record.grade
    const numeric = /^(?:[1-9](?:\.5)?|10)$/.test(grade)
    if (!numeric || (record.provider.id === "ace" && !/^(?:[1-9]|10)$/.test(grade)) || (record.provider.id === "psa" && grade === "9.5")) {
      notes.push("Review this recorded grade against the provider scale and holder version. Legacy or text values are kept as entered.")
    }
  }
  return notes
}
