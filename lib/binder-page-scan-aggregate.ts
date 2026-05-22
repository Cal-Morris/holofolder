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
  if (results.length === 0) return null
  const aggregated = aggregateBinderPageScanResults(results, options)
  const stableGrid = getMedianGridRegion(results)
  const baseResult = getRepresentativeResult(results, stableGrid)

  return {
    ...baseResult,
    grid: stableGrid,
    slots: baseResult.slots.map((slot) => {
      const aggregate = aggregated.slots[slot.index]
      const occupied = aggregate?.occupied ?? false
      const stableSlot = getMedianSlotResult(results, slot.index) ?? slot
      const bestOccupiedSlot = getBestOccupiedSlotResult(results, slot.index)

      return {
        ...stableSlot,
        occupied,
        confidence: aggregate?.averageConfidence ?? slot.confidence,
        cardImageDataUrl: occupied ? bestOccupiedSlot?.cardImageDataUrl : undefined,
      }
    }),
  }
}

function getRepresentativeResult(results: BinderPageScanResult[], stableGrid: BinderPageScanResult["grid"]) {
  return [...results].sort((left, right) =>
    getGridDistance(left.grid, stableGrid) - getGridDistance(right.grid, stableGrid)
  )[0]
}

function getGridDistance(left: BinderPageScanResult["grid"], right: BinderPageScanResult["grid"]) {
  return (
    Math.abs(left.x - right.x) +
    Math.abs(left.y - right.y) +
    Math.abs(left.width - right.width) +
    Math.abs(left.height - right.height)
  )
}

function getMedianGridRegion(results: BinderPageScanResult[]) {
  return {
    x: roundedMedian(results.map((result) => result.grid.x)),
    y: roundedMedian(results.map((result) => result.grid.y)),
    width: roundedMedian(results.map((result) => result.grid.width)),
    height: roundedMedian(results.map((result) => result.grid.height)),
    confidence: median(results.map((result) => result.grid.confidence)),
  }
}

function getMedianSlotResult(results: BinderPageScanResult[], slotIndex: number) {
  const slots = results
    .map((result) => result.slots[slotIndex])
    .filter((slot): slot is BinderPageScanResult["slots"][number] => Boolean(slot))

  if (slots.length === 0) {
    return null
  }

  return {
    ...slots[slots.length - 1],
    x: roundedMedian(slots.map((slot) => slot.x)),
    y: roundedMedian(slots.map((slot) => slot.y)),
    width: roundedMedian(slots.map((slot) => slot.width)),
    height: roundedMedian(slots.map((slot) => slot.height)),
    score: median(slots.map((slot) => slot.score)),
  }
}

function getBestOccupiedSlotResult(results: BinderPageScanResult[], slotIndex: number) {
  return results
    .map((result) => result.slots[slotIndex])
    .filter((slot): slot is BinderPageScanResult["slots"][number] => Boolean(slot?.occupied && slot.cardImageDataUrl))
    .sort((left, right) => right.confidence - left.confidence)[0]
}

function roundedMedian(values: number[]) {
  return Math.round(median(values))
}

function median(values: number[]) {
  if (values.length === 0) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)

  if (sorted.length % 2 === 1) {
    return sorted[midpoint]
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}
