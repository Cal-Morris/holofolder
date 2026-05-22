const MAX_TEXT_BOOST = 0.24
const OCR_WORD_MIN_LENGTH = 2
const OCR_DIGIT_CONFUSIONS: Record<string, string> = {
  o: "0",
  i: "1",
  l: "1",
  s: "5",
  b: "8",
}
const COLLECTOR_SIDE_PATTERN = /^[a-z]{0,4}[0-9oilsb]{1,4}$/
const STANDALONE_COLLECTOR_PREFIXES = new Set([
  "bw",
  "dp",
  "gg",
  "hgss",
  "pop",
  "sm",
  "svp",
  "swsh",
  "tg",
  "xy",
])

interface ParsedCollectorSide {
  normalized: string
  prefix: string
  hasActualDigit: boolean
}

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

export interface ApplyCardTextSignalBoostOptions<TCard> {
  candidateCards?: TCard[]
  getCardId?: (card: TCard) => string
  minimumTextOnlyScore?: number
  textOnlyBaseSimilarity?: number
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\\[nr]/g, " ")
    .replace(/[|]/g, "/")
    .replace(/[^a-z0-9/\s.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseCollectorSide(value: string | undefined, preservePrefix: boolean): ParsedCollectorSide | null {
  if (!value) return null
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "")
  const match = compact.match(/^([a-z]*?)([0-9oilsb]{1,4})$/)
  if (!match) return null

  const prefix = preservePrefix ? match[1] : ""
  const normalizedDigits = match[2].replace(/[oilsb]/g, (char) => OCR_DIGIT_CONFUSIONS[char] ?? char)
  const parsed = Number.parseInt(normalizedDigits, 10)
  if (!Number.isFinite(parsed)) return null

  return {
    normalized: `${prefix}${parsed}`,
    prefix: match[1],
    hasActualDigit: /\d/.test(match[2]),
  }
}

function normalizeCollectorSide(value: string | undefined, preservePrefix: boolean) {
  return parseCollectorSide(value, preservePrefix)?.normalized ?? ""
}

function isCollectorSideCandidate(value: string) {
  if (!COLLECTOR_SIDE_PATTERN.test(value)) return false
  const parsed = parseCollectorSide(value, true)
  if (!parsed) return false

  return parsed.hasActualDigit || parsed.prefix.length > 0
}

function normalizeNumberToken(value: string, preservePrefix = false) {
  const [left, right] = value.split("/")
  const normalizedLeft = normalizeCollectorSide(left, preservePrefix)
  const normalizedRight = normalizeCollectorSide(right, preservePrefix)

  if (normalizedLeft && normalizedRight) return `${normalizedLeft}/${normalizedRight}`
  return normalizedLeft || normalizedRight
}

function addCollectorNumber(numbers: string[], seen: Set<string>, value: string, preservePrefix = false) {
  const normalized = normalizeNumberToken(value, preservePrefix)
  if (!normalized || seen.has(normalized)) return

  seen.add(normalized)
  numbers.push(normalized)
}

export function extractCardTextSignals(rawText: string): CardTextSignals {
  const normalizedText = normalizeText(rawText)
  const textTokens = normalizedText.split(/\s+/).filter(Boolean)
  const words = new Set(
    textTokens
      .map((word) => word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
      .filter((word) => word.length >= OCR_WORD_MIN_LENGTH && /[a-z]/.test(word)),
  )
  const collectorNumbers: string[] = []
  const seenNumbers = new Set<string>()

  for (const match of normalizedText.matchAll(/\b([a-z]{0,4}[0-9oilsb]{1,4})\s*\/\s*([a-z]{0,4}[0-9oilsb]{1,4})\b/g)) {
    const left = match[1]
    const right = match[2]
    if (!isCollectorSideCandidate(left) || !isCollectorSideCandidate(right)) continue

    const hasPrefix = /[a-z]/.test(left) || /[a-z]/.test(right)

    if (hasPrefix) {
      addCollectorNumber(collectorNumbers, seenNumbers, `${left}/${right}`, true)
      addCollectorNumber(collectorNumbers, seenNumbers, left, true)
      addCollectorNumber(collectorNumbers, seenNumbers, right, true)
    }

    addCollectorNumber(collectorNumbers, seenNumbers, `${left}/${right}`)
    addCollectorNumber(collectorNumbers, seenNumbers, left)
    addCollectorNumber(collectorNumbers, seenNumbers, right)
  }

  for (const match of normalizedText.matchAll(/(?:\bno\.?|#)\s*(\d{1,4})\b/g)) {
    addCollectorNumber(collectorNumbers, seenNumbers, match[1])
  }

  for (const token of textTokens) {
    const cleanedToken = token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    const parsed = parseCollectorSide(cleanedToken, true)
    if (!parsed || !parsed.prefix || !STANDALONE_COLLECTOR_PREFIXES.has(parsed.prefix)) continue

    addCollectorNumber(collectorNumbers, seenNumbers, cleanedToken, true)
    addCollectorNumber(collectorNumbers, seenNumbers, cleanedToken)
  }

  for (let index = 0; index < textTokens.length - 1; index += 1) {
    const left = textTokens[index].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    const right = textTokens[index + 1].replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    const leftHasDigit = /\d/.test(left)
    const rightHasDigit = /\d/.test(right)

    if (!leftHasDigit || !rightHasDigit) continue
    if (!isCollectorSideCandidate(left) || !isCollectorSideCandidate(right)) continue

    const hasPrefix = /[a-z]/.test(left) || /[a-z]/.test(right)
    const leftNumeric = normalizeNumberToken(left)
    const rightNumeric = normalizeNumberToken(right)
    const numericLeftValue = Number.parseInt(leftNumeric, 10)
    const numericRightValue = Number.parseInt(rightNumeric, 10)

    if (
      !Number.isFinite(numericLeftValue) ||
      !Number.isFinite(numericRightValue) ||
      numericRightValue < numericLeftValue ||
      numericRightValue > 999
    ) {
      continue
    }

    if (hasPrefix) {
      addCollectorNumber(collectorNumbers, seenNumbers, `${left}/${right}`, true)
      addCollectorNumber(collectorNumbers, seenNumbers, left, true)
      addCollectorNumber(collectorNumbers, seenNumbers, right, true)
    }

    addCollectorNumber(collectorNumbers, seenNumbers, `${left}/${right}`)
    addCollectorNumber(collectorNumbers, seenNumbers, left)
    addCollectorNumber(collectorNumbers, seenNumbers, right)
  }

  return {
    rawText,
    normalizedText,
    collectorNumbers,
    words,
  }
}

export function mergeCardTextSignals(signals: Array<CardTextSignals | null | undefined>): CardTextSignals | null {
  const usefulSignals = signals.filter((signal): signal is CardTextSignals => Boolean(signal))
  if (usefulSignals.length === 0) return null

  const rawText = usefulSignals.map((signal) => signal.rawText).filter(Boolean).join("\n")
  const merged = extractCardTextSignals(rawText)
  const collectorNumberSet = new Set(merged.collectorNumbers)

  for (const signal of usefulSignals) {
    for (const collectorNumber of signal.collectorNumbers) {
      if (collectorNumberSet.has(collectorNumber)) continue
      collectorNumberSet.add(collectorNumber)
      merged.collectorNumbers.push(collectorNumber)
    }

    for (const word of signal.words) {
      merged.words.add(word)
    }
  }

  return merged.normalizedText || merged.words.size > 0 || merged.collectorNumbers.length > 0 ? merged : null
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

function getPrefixedCardNumberAliases(localId?: string) {
  if (!localId || !/[a-z]/i.test(localId)) return []

  const aliases = new Set<string>()
  const normalized = normalizeNumberToken(localId, true)
  if (normalized) {
    aliases.add(normalized)
    normalized.split("/").filter(Boolean).forEach((part) => aliases.add(part))
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
  const prefixedCardNumberAliases = getPrefixedCardNumberAliases(card.localId)
  const numberHit = cardNumberAliases.some((alias) => signals.collectorNumbers.includes(alias))
  const prefixedNumberHit = prefixedCardNumberAliases.some((alias) => signals.collectorNumbers.includes(alias))
  const fullNumberHit = cardNumberAliases.some((alias) => alias.includes("/") && signals.collectorNumbers.includes(alias))
  const fullPrefixedNumberHit = prefixedCardNumberAliases.some((alias) => alias.includes("/") && signals.collectorNumbers.includes(alias))
  const nameScore = scoreWordOverlap(signals, getWords(card.name))
  const setNameScore = scoreWordOverlap(signals, getWords(card.set?.name))
  const setIdScore = card.set?.id && signals.normalizedText.includes(normalizeText(card.set.id)) ? 1 : 0

  return Math.min(
    1,
    (fullPrefixedNumberHit ? 0.72 : fullNumberHit ? 0.62 : prefixedNumberHit ? 0.54 : numberHit ? 0.38 : 0) +
      nameScore * 0.18 +
      Math.max(setNameScore, setIdScore) * 0.2,
  )
}

export function applyCardTextSignalBoost<TCard extends TextMatchableCard>(
  matches: Array<{ card: TCard; similarity: number }>,
  signals: CardTextSignals | null | undefined,
  options: ApplyCardTextSignalBoostOptions<TCard> = {},
): Array<TextBoostedCardMatch<TCard>> {
  const getCardId = options.getCardId
  const minimumTextOnlyScore = options.minimumTextOnlyScore ?? 0.54
  const textOnlyBaseSimilarity = options.textOnlyBaseSimilarity ?? 0.55
  const seenCardIds = new Set<string>()
  const boostedMatches = matches
    .map((match) => {
      const textScore = scoreCardTextSignals(signals, match.card)
      const cardId = getCardId?.(match.card)
      if (cardId) {
        seenCardIds.add(cardId)
      }

      return {
        card: match.card,
        textScore,
        similarity: Math.min(1, match.similarity + textScore * MAX_TEXT_BOOST),
      }
    })

  if (signals && options.candidateCards) {
    for (const card of options.candidateCards) {
      const cardId = getCardId?.(card)
      if (cardId && seenCardIds.has(cardId)) continue

      const textScore = scoreCardTextSignals(signals, card)
      if (textScore < minimumTextOnlyScore) continue

      boostedMatches.push({
        card,
        textScore,
        similarity: Math.min(1, textOnlyBaseSimilarity + textScore * MAX_TEXT_BOOST),
      })
    }
  }

  return boostedMatches
    .sort((left, right) => {
      if (right.similarity !== left.similarity) return right.similarity - left.similarity
      return right.textScore - left.textScore
    })
}
