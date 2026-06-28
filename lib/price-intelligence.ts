export type PriceProvider = "tcgplayer" | "cardmarket" | "ebay" | "pricecharting" | "pokescope" | "pokepulse" | "eyevo" | "public-page"
export type PriceCurrency = "USD" | "EUR" | "GBP"
export type PriceMatchRating = "exact" | "strong" | "weak" | "rejected"
export type BuySignalStatus = "good" | "fair" | "hold" | "rising"

export interface PriceSubject {
  cardId: string
  name: string
  setId: string | null
  setName: string | null
  localId: string | null
  language: string
}

export interface PriceObservation {
  provider: PriceProvider
  title: string
  sourceUrl: string
  amount: number
  currency: PriceCurrency
  observedAt: string
  soldAt?: string | null
  condition?: string | null
}

export interface PriceObservationMatch {
  score: number
  rating: PriceMatchRating
  rejected: boolean
  reasons: string[]
  rejectReasons: string[]
}

export interface CardBuySignal {
  status: BuySignalStatus
  label: string
  reason: string
}

const MULTI_CARD_PATTERNS = [
  /\bchoose\s+your\s+card\b/i,
  /\bpick\s+your\s+card\b/i,
  /\bselect\s+your\s+card\b/i,
  /\bcomplete\s+set\b/i,
]

const LOT_PATTERNS = [
  /\blot\b/i,
  /\bbundle\b/i,
  /\b\d+\s+cards?\b/i,
]

const GRADED_PATTERNS = [
  /\bpsa\s*\d+/i,
  /\bcgc\s*\d+/i,
  /\bbgs\s*\d+/i,
  /\bbeckett\s*\d+/i,
  /\bgraded\b/i,
  /\bslab\b/i,
]

const BAD_PATTERNS = [
  /\bproxy\b/i,
  /\bcustom\b/i,
  /\bfake\b/i,
  /\bdigital\b/i,
]

export function buildPriceResearchHeaders(contactUrl = "https://binder.cal.gg") {
  return {
    "User-Agent": `BinderDexPriceResearch/1.0 (+${contactUrl})`,
    Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  }
}

export function scorePriceObservationMatch(subject: PriceSubject, observation: PriceObservation): PriceObservationMatch {
  const title = observation.title.trim()
  const rejectReasons = hardRejectReasons(title)

  if (rejectReasons.length > 0) {
    return rejectedMatch(rejectReasons)
  }

  const normalizedTitle = normalizeComparableText(title)
  const normalizedName = normalizeComparableText(subject.name)
  const reasons: string[] = []
  let score = 0

  if (normalizedName && hasTokenSequence(normalizedTitle, normalizedName)) {
    score += 35
    reasons.push("name matched")
  } else {
    return rejectedMatch(["card name missing"])
  }

  const numberAliases = buildCollectorNumberAliases(subject)
  const prefixedNumberAliases = numberAliases.filter((alias) => /[a-z]/.test(alias) && /\d/.test(alias))

  const prefixedNumberMatched = prefixedNumberAliases.some((alias) => normalizedTitle.includes(alias))
  if (numberAliases.some((alias) => normalizedTitle.includes(alias))) {
    score += 40
    reasons.push("number matched")
  }

  const conflictingPrefixedNumber = findConflictingPrefixedCollectorNumber(normalizedTitle, prefixedNumberAliases)
  if (conflictingPrefixedNumber) {
    return rejectedMatch(["collector number mismatch"])
  }

  const setSignals = buildSetSignals(subject)
  if (setSignals.some((signal) => hasTokenSequence(normalizedTitle, signal)) || prefixedNumberMatched) {
    score += 20
    reasons.push("set matched")
  }

  if (observation.soldAt) {
    score += 5
    reasons.push("sold comp")
  }

  const rating: PriceMatchRating = score >= 90 ? "exact" : score >= 70 ? "strong" : "weak"

  return {
    score,
    rating,
    rejected: false,
    reasons,
    rejectReasons: [],
  }
}

export function buildBuySignal(input: {
  marketGbpAmount: number | null
  lowGbpAmount: number | null
  highGbpAmount: number | null
  trendPoints: Array<{ label: string; gbpAmount: number }>
}): CardBuySignal | null {
  const market = input.marketGbpAmount
  if (market == null || !Number.isFinite(market)) return null

  const current = readTrendPoint(input.trendPoints, ["trend", "now", "1d"]) ?? market
  const avg7 = readTrendPoint(input.trendPoints, ["7d"])
  const avg30 = readTrendPoint(input.trendPoints, ["30d"])

  if (avg30 != null) {
    const ratio = current / avg30
    if (ratio <= 0.9) {
      return {
        status: "good",
        label: "Good time",
        reason: `Current trend is ${formatPercent(1 - ratio)} below 30d average.`,
      }
    }

    if (ratio >= 1.15) {
      return {
        status: "rising",
        label: "Rising",
        reason: `Current trend is ${formatPercent(ratio - 1)} above 30d average.`,
      }
    }
  }

  if (avg7 != null) {
    const ratio = current / avg7
    if (ratio <= 0.92) {
      return {
        status: "good",
        label: "Good time",
        reason: `Current trend is ${formatPercent(1 - ratio)} below 7d average.`,
      }
    }

    if (ratio >= 1.1) {
      return {
        status: "rising",
        label: "Rising",
        reason: `Current trend is ${formatPercent(ratio - 1)} above 7d average.`,
      }
    }
  }

  if (avg7 == null && avg30 == null) {
    return {
      status: "hold",
      label: "Thin data",
      reason: "Not enough recent history to call the timing.",
    }
  }

  const low = input.lowGbpAmount
  const high = input.highGbpAmount
  if (low != null && high != null && market <= low + (high - low) * 0.35) {
    return {
      status: "fair",
      label: "Fair",
      reason: "Market is in the lower part of the current expected range.",
    }
  }

  return {
    status: "hold",
    label: "Hold",
    reason: "Market is close to recent history.",
  }
}

function hardRejectReasons(title: string) {
  const reasons: string[] = []
  if (MULTI_CARD_PATTERNS.some((pattern) => pattern.test(title))) reasons.push("multi-card selection listing")
  if (LOT_PATTERNS.some((pattern) => pattern.test(title))) reasons.push("lot or bundle listing")
  if (GRADED_PATTERNS.some((pattern) => pattern.test(title))) reasons.push("graded slab listing")
  if (BAD_PATTERNS.some((pattern) => pattern.test(title))) reasons.push("proxy or custom listing")
  return reasons
}

function rejectedMatch(rejectReasons: string[]): PriceObservationMatch {
  return {
    score: 0,
    rating: "rejected",
    rejected: true,
    reasons: [],
    rejectReasons,
  }
}

function normalizeComparableText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

function hasTokenSequence(text: string, needle: string) {
  return ` ${text} `.includes(` ${needle} `)
}

function buildCollectorNumberAliases(subject: PriceSubject) {
  if (!subject.localId) return []

  const localId = normalizeComparableText(subject.localId)
  const unpaddedLocalId = localId.replace(/^0+/, "") || localId
  const setId = subject.setId ? normalizeComparableText(subject.setId).replace(/\s+/g, "") : ""
  const aliases = new Set<string>([localId, unpaddedLocalId, `# ${localId}`, `#${localId}`])

  if (setId) {
    aliases.add(`${setId}${localId}`)
    aliases.add(`${setId}${unpaddedLocalId}`)
    aliases.add(`${setId} ${localId}`)
    aliases.add(`${setId} ${unpaddedLocalId}`)
  }

  return [...aliases].map((alias) => alias.replace(/[^a-z0-9#]+/g, " ").trim())
}

function buildSetSignals(subject: PriceSubject) {
  return [subject.setId, subject.setName]
    .flatMap((value) => value ? [normalizeComparableText(value), normalizeComparableText(value).replace(/\s+/g, "")] : [])
    .filter(Boolean)
}

function findConflictingPrefixedCollectorNumber(normalizedTitle: string, validAliases: string[]) {
  if (validAliases.length === 0) return null

  const compactTitle = normalizedTitle.replace(/\s+/g, "")
  const validCompacts = new Set(validAliases.map((alias) => alias.replace(/\s+/g, "")))
  const setPrefixes = new Set([...validCompacts].map((alias) => alias.replace(/\d+$/, "")).filter(Boolean))

  for (const prefix of setPrefixes) {
    const matches = compactTitle.match(new RegExp(`${escapeRegExp(prefix)}0*\\d{1,4}`, "g")) ?? []
    for (const match of matches) {
      if (!validCompacts.has(match)) {
        return match
      }
    }
  }

  return null
}

function readTrendPoint(points: Array<{ label: string; gbpAmount: number }>, labels: string[]) {
  const wanted = new Set(labels.map((label) => label.toLowerCase()))
  const point = [...points].reverse().find((candidate) => wanted.has(candidate.label.toLowerCase()))
  return point && Number.isFinite(point.gbpAmount) ? point.gbpAmount : null
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
