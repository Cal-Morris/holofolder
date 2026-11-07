"use client"

import type { RevisitCard } from "@/lib/show-revisit"
import { revisitKey } from "@/lib/show-revisit"
import { formatMoney } from "@/lib/regional-price"
import { formatCardFinishLabel } from "@/lib/card-labels"

export default function ShowRevisit({ cards, onOpen, onRemove, error }: {
  cards: RevisitCard[]
  onOpen: (card: RevisitCard) => void
  onRemove: (card: RevisitCard) => void
  error: string | null
}) {
  if (!cards.length && !error) return null
  return <section aria-label="Revisit deals" className="min-w-0 border-b border-border/50 py-2">
    <h3 className="text-sm font-semibold">Come back to these</h3>
    <p className="text-xs text-muted-foreground">Saved on this device</p>
    {error && <p role="status" className="text-sm">{error}</p>}
    <ul className="mt-2 space-y-2">
      {cards.map(entry => <li key={revisitKey(entry.card)} className="flex min-w-0 items-start gap-1 rounded-xl border border-border/60">
        <button type="button" onClick={() => onOpen(entry)} aria-label={`Revisit ${entry.card.name}, ${entry.card.setName}, ${formatCardFinishLabel(entry.card.finish)}`} className="min-h-12 min-w-0 flex-1 p-3 text-left">
          <span className="block truncate text-sm font-semibold">{entry.card.name}{entry.askingPrice !== null ? ` · ${formatMoney(entry.askingPrice, entry.currency)}` : ""}</span>
          <span className="block text-xs text-muted-foreground">{entry.card.setName} · {entry.card.number} · {formatCardFinishLabel(entry.card.finish)}</span>
          {entry.note && <span className="mt-1 block whitespace-pre-wrap break-words text-sm">{entry.note}</span>}
        </button>
        <button type="button" onClick={() => onRemove(entry)} aria-label={`Remove ${entry.card.name} from revisit list`} className="min-h-10 shrink-0 rounded-xl px-3 text-xs">Remove</button>
      </li>)}
    </ul>
  </section>
}
