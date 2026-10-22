import { CARD_LANGUAGES } from "@/lib/domain/cards"
import { FINISH_LABELS } from "@/lib/card-highlights"
import type { WantedDashboardCard } from "@/lib/wanted-dashboard"

type AmountFormatter = (card: WantedDashboardCard) => string | null

function finishLabel(finish: string | undefined) {
  if (!finish || finish === "normal") return null
  return (FINISH_LABELS as Record<string, string>)[finish] ?? finish.replaceAll("_", " ").replace(/^./, letter => letter.toUpperCase())
}

function cardNumber(card: WantedDashboardCard["card"]) {
  if (!card.local_id) return null
  return card.set_total ? `${card.local_id}/${card.set_total}` : card.local_id
}

function numericLocalId(card: WantedDashboardCard["card"]) {
  const value = Number.parseInt(card.local_id ?? "", 10)
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
}

/**
 * The want list as plain text for messages and notes: grouped by set, one card per line, with number,
 * non-standard finish, non-English language and the displayed price when known.
 */
export function buildWantedListText(cards: WantedDashboardCard[], formatAmount: AmountFormatter) {
  const bySet = new Map<string, WantedDashboardCard[]>()
  for (const entry of cards) {
    const set = entry.card.card_set?.trim() || "Other"
    bySet.set(set, [...(bySet.get(set) ?? []), entry])
  }
  const lines = [`Want list · ${cards.length} card${cards.length === 1 ? "" : "s"}`]
  for (const set of [...bySet.keys()].sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)))) {
    lines.push("", set)
    const entries = bySet.get(set)!.sort((a, b) => numericLocalId(a.card) - numericLocalId(b.card) || a.card.card_name.localeCompare(b.card.card_name))
    for (const entry of entries) {
      const language = entry.card.card_language && entry.card.card_language !== CARD_LANGUAGES[0] ? entry.card.card_language.toUpperCase() : null
      const name = [entry.card.card_name, cardNumber(entry.card)].filter(Boolean).join(" ")
      lines.push(`• ${[name, finishLabel(entry.card.card_finish), language, formatAmount(entry)].filter(Boolean).join(" · ")}`)
    }
  }
  return lines.join("\n")
}
