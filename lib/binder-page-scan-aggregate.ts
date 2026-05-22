import type { BinderPageScanResult } from "@/lib/binder-page-scan"

export interface BinderPageScanSlotAggregate {
  occupied: boolean
  occupiedVotes: number
  averageConfidence: number
}

export interface BinderPageScanAggregateOptions {
  requiredVotes?: number
  voteRatio?: number
}

export interface BinderPageScanAggregateResult {
  requiredVotes: number
  slots: BinderPageScanSlotAggregate[]
}

const DEFAULT_VOTE_RATIO = 0.45

export function aggregateBinderPageScanResults(
  results: BinderPageScanResult[],
  options: BinderPageScanAggregateOptions = {},
): BinderPageScanAggregateResult {
  const slotCount = results[0]?.slots.length ?? 0
  const requiredVotes = options.requiredVotes ?? Math.max(1, Math.ceil(results.length * (options.voteRatio ?? DEFAULT_VOTE_RATIO)))
  const aggregates = Array.from({ length: slotCount }, () => ({
    occupiedVotes: 0,
    confidenceSum: 0,
  }))

  for (const result of results) {
    result.slots.forEach((slot, index) => {
      if (!aggregates[index]) return

      if (slot.occupied) {
        aggregates[index].occupiedVotes += 1
      }
      aggregates[index].confidenceSum += slot.confidence
    })
  }

  return {
    requiredVotes,
    slots: aggregates.map((aggregate) => ({
      occupied: aggregate.occupiedVotes >= requiredVotes,
      occupiedVotes: aggregate.occupiedVotes,
      averageConfidence: results.length > 0 ? aggregate.confidenceSum / results.length : 0,
    })),
  }
}

export function buildAggregatedBinderPageScanPreview(
  results: BinderPageScanResult[],
  options: BinderPageScanAggregateOptions = {},
): BinderPageScanResult | null {
  const baseResult = results[results.length - 1]
  if (!baseResult) return null

  const aggregated = aggregateBinderPageScanResults(results, options)

  return {
    ...baseResult,
    slots: baseResult.slots.map((slot) => {
      const aggregate = aggregated.slots[slot.index]
      const occupied = aggregate?.occupied ?? false

      return {
        ...slot,
        occupied,
        confidence: aggregate?.averageConfidence ?? slot.confidence,
        cardImageDataUrl: occupied ? slot.cardImageDataUrl : undefined,
      }
    }),
  }
}
