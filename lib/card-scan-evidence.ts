export interface CardScanImageCandidate {
  dataUrl: string
  quality: number
}

export function selectCardScanEvidenceImages(candidates: CardScanImageCandidate[], limit: number) {
  if (limit <= 0) return []

  const bestByDataUrl = new Map<string, CardScanImageCandidate & { firstIndex: number }>()

  candidates.forEach((candidate, index) => {
    if (!candidate.dataUrl) return

    const existing = bestByDataUrl.get(candidate.dataUrl)
    const quality = Number.isFinite(candidate.quality) ? candidate.quality : 0

    if (!existing || quality > existing.quality) {
      bestByDataUrl.set(candidate.dataUrl, {
        dataUrl: candidate.dataUrl,
        quality,
        firstIndex: existing?.firstIndex ?? index,
      })
    }
  })

  return [...bestByDataUrl.values()]
    .sort((left, right) => {
      if (right.quality !== left.quality) return right.quality - left.quality
      return left.firstIndex - right.firstIndex
    })
    .slice(0, limit)
    .map((candidate) => candidate.dataUrl)
}
