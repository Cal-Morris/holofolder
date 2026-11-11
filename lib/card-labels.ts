import { getPriceSourceLabel, type CardPriceSnapshot } from "@/hooks/use-card-prices"
import type { CardFinish, CardLanguage } from "@/lib/domain/cards"

export const CARD_LANGUAGE_LABELS: Record<CardLanguage, string> = {
  en: "English",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  "pt-br": "Portuguese",
  ja: "Japanese",
  ko: "Korean",
}

export const CARD_FINISH_LABELS: Record<CardFinish, string> = {
  normal: "Normal",
  holo: "Holo",
  reverse_holo: "Reverse holo",
  double_rare: "Double rare",
  ultra_rare: "Ultra rare",
  illustration_rare: "IR",
  special_illustration_rare: "SIR",
  secret_rare: "Secret",
  hyper_rare: "Hyper",
  radiant_rare: "Radiant",
  ace_spec: "ACE SPEC",
  amazing_rare: "Amazing",
  shiny_rare: "Shiny",
  jumbo: "Jumbo",
}

export function formatCardLanguageLabel(language?: string | null) {
  return CARD_LANGUAGE_LABELS[(language || "en") as CardLanguage] ?? CARD_LANGUAGE_LABELS.en
}

export function formatCardFinishLabel(finish?: string | null) {
  return CARD_FINISH_LABELS[(finish || "normal") as CardFinish] ?? CARD_FINISH_LABELS.normal
}

export function formatPriceConfidenceLabel(price: CardPriceSnapshot | undefined) {
  if (!price || price.confidence === "unknown") {
    return null
  }

  return `${price.confidence.charAt(0).toUpperCase()}${price.confidence.slice(1)} confidence`
}

export function formatPriceSourceLabel(price: CardPriceSnapshot | undefined) {
  if (!price?.source) {
    return null
  }

  const source = getPriceSourceLabel(price.source)
  return price.variantLabel ? `${source}, ${price.variantLabel}` : source
}
