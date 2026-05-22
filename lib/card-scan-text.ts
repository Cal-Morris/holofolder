const MAX_TEXT_BOOST = 0.24
const OCR_WORD_MIN_LENGTH = 2

export interface CardTextSignals {
  rawText: string
  normalizedText: string
  collectorNumbers: string[]
  words: Set<string>
}

export interface TextMatchableCard {
  name?: string
  localId?: string
  set?: {
    id?: string
    name?: string
  }
}

export interface TextBoostedCardMatch<TCard> {
  card: TCard
  similarity: number
  textScore: number
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[|]/g, "/")
    .replace(/[^a-z0-9/\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeNumberToken(value: string) {
  const [left, right] = value.split("/")
  const normalizeSide = (side?: string) => {
    if (!side) return ""
    const parsed = Number.parseInt(side.replace(/\D/g, ""), 10)
    return Number.isFinite(parsed) ? String(parsed) : ""
  }
  const normalizedLeft = normalizeSide(left)
  const normalizedRight = normalizeSide(right)

  if (normalizedLeft && normalizedRight) return `${normalizedLeft}/${normalizedRight}`
  return normalizedLeft || normalizedRight
}

function addCollectorNumber(numbers: string[], seen: Set<string>, value: string) {
  const normalized = normalizeNumberToken(value)
  if (!normalized || seen.has(normalized)) return

  seen.add(normalized)
  numbers.push(normalized)
}

export function extractCardTextSignals(rawText: string): CardTextSignals {
  const normalizedText = normalizeText(rawText)
  const words = new Set(
    normalizedText
      .split(/\s+/)
      .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter((word) => word.length >= OCR_WORD_MIN_LENGTH && /[a-z]/.test(word)),
  )
  const collectorNumbers: string[] = []
  const seenNumbers = new Set<string>()

  for (const match of normalizedText.matchAll(/\b([a-z]{0,3}\d{1,4})\s*\/\s*(\d{1,4})\b/g)) {
    const left = match[1].replace(/^[a-z]+/, "")
    const right = match[2]
    addCollectorNumber(collectorNumbers, seenNumbers, `${left}/${right}`)
    addCollectorNumber(collectorNumbers, seenNumbers, left)
    addCollectorNumber(collectorNumbers, seenNumbers, right)
  }

  for (const match of normalizedText.matchAll(/(?:\bno\.?|#)\s*(\d{1,4})\b/g)) {
    addCollectorNumber(collectorNumbers, seenNumbers, match[1])
  }

  return {
    rawText,
    normalizedText,
    collectorNumbers,
    words,
  }
}

function getCardNumberAliases(localId?: string) {
  if (!localId) return []

  const aliases = new Set<string>()
  const normalized = normalizeNumberToken(localId)
  if (normalized) {
    aliases.add(normalized)
    normalized.split("/").filter(Boolean).forEach((part) => aliases.add(part))
  }

  const numericMatch = localId.match(/\d+/)
  if (numericMatch) {
    aliases.add(normalizeNumberToken(numericMatch[0]))
  }

  return [...aliases].filter(Boolean)
}

function getWords(value?: string) {
  if (!value) return []
  return normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length >= OCR_WORD_MIN_LENGTH && /[a-z]/.test(word))
}

function scoreWordOverlap(signals: CardTextSignals, words: string[]) {
  if (words.length === 0) return 0

  let hits = 0
  for (const word of words) {
    if (signals.words.has(word)) {
      hits += 1
    }
  }

  return hits / words.length
}

export function scoreCardTextSignals(signals: CardTextSignals | null | undefined, card: TextMatchableCard) {
  if (!signals || (!signals.normalizedText && signals.words.size === 0 && signals.collectorNumbers.length === 0)) {
    return 0
  }

  const cardNumberAliases = getCardNumberAliases(card.localId)
  const numberHit = cardNumberAliases.some((alias) => signals.collectorNumbers.includes(alias))
  const fullNumberHit = cardNumberAliases.some((alias) => alias.includes("/") && signals.collectorNumbers.includes(alias))
  const nameScore = scoreWordOverlap(signals, getWords(card.name))
  const setNameScore = scoreWordOverlap(signals, getWords(card.set?.name))
  const setIdScore = card.set?.id && signals.normalizedText.includes(normalizeText(card.set.id)) ? 1 : 0

  return Math.min(
    1,
    (fullNumberHit ? 0.62 : numberHit ? 0.38 : 0) +
      nameScore * 0.18 +
      Math.max(setNameScore, setIdScore) * 0.2,
  )
}

export function applyCardTextSignalBoost<TCard extends TextMatchableCard>(
  matches: Array<{ card: TCard; similarity: number }>,
  signals: CardTextSignals | null | undefined,
): Array<TextBoostedCardMatch<TCard>> {
  return matches
    .map((match) => {
      const textScore = scoreCardTextSignals(signals, match.card)
      return {
        card: match.card,
        textScore,
        similarity: Math.min(1, match.similarity + textScore * MAX_TEXT_BOOST),
      }
    })
    .sort((left, right) => {
      if (right.similarity !== left.similarity) return right.similarity - left.similarity
      return right.textScore - left.textScore
    })
}
