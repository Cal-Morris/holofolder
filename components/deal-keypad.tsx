"use client"

// The asking-price field and verdict panel shared by Show mode's card check and bundle check.
import { useEffect, useRef } from "react"
import type { DealCheck, DealVerdict } from "@/lib/deal-check"

export const DEAL_VERDICT_TONE: Record<DealVerdict, string> = {
  great: "bg-emerald-600 text-white",
  good: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  fair: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  overpriced: "bg-amber-500/20 text-amber-900 dark:text-amber-300",
  "walk-away": "bg-red-600 text-white",
}

// While the phone's keyboard is up (html[data-keyboard-open], lib/keyboard-inset.ts) the full verdict in
// the scrolling area is usually pushed off screen, so it steps aside and a one-line copy pinned right
// above the asking field takes over. With the keyboard down the layout is the usual one.
const HIDE_WHILE_TYPING = "[html[data-keyboard-open]_&]:hidden"
const SHOW_WHILE_TYPING = "hidden [html[data-keyboard-open]_&]:flex"

/** Footer controls (action buttons) that step aside while the phone's keyboard is up. */
export const DEAL_HIDE_WHILE_TYPING = HIDE_WHILE_TYPING

function dealDiffText(deal: DealCheck, money: (amount: number) => string) {
  return `${deal.diffPct === 0 ? "At market" : `${Math.abs(deal.diffPct)}% ${deal.diffPct < 0 ? "under" : "over"}`} · ${deal.diffAmount < 0 ? "−" : "+"}${money(Math.abs(deal.diffAmount))}`
}

/** One-line verdict pinned above the asking field, shown only while the phone's keyboard is up. */
export function PinnedDealVerdict({ deal, money, emptyText, testId = "deal-verdict-pinned" }: { deal: DealCheck | null; money: (amount: number) => string; emptyText: string; testId?: string }) {
  return (
    <div
      className={`mb-2 ${SHOW_WHILE_TYPING} min-h-10 items-center justify-between gap-2 rounded-xl px-3 py-1.5 ${deal ? DEAL_VERDICT_TONE[deal.verdict] : "border border-dashed border-border/70"}`}
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-verdict={deal?.verdict ?? ""}
    >
      {deal ? (
        <>
          <span className="truncate text-base font-black">{deal.label}</span>
          <span className="shrink-0 text-sm font-bold tabular-nums">{dealDiffText(deal, money)}</span>
        </>
      ) : (
        <span className="truncate text-xs text-muted-foreground">{emptyText}</span>
      )}
    </div>
  )
}

export function DealVerdictPanel({ deal, money, emptyText, testId = "deal-verdict" }: { deal: DealCheck | null; money: (amount: number) => string; emptyText: string; testId?: string }) {
  return (
    <div
      className={`${HIDE_WHILE_TYPING} rounded-2xl px-3 py-3 ${deal ? DEAL_VERDICT_TONE[deal.verdict] : "border border-dashed border-border/70"}`}
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-verdict={deal?.verdict ?? ""}
    >
      {deal ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-2">
            <span className="text-xl font-black">{deal.label}</span>
            <span className="text-sm font-bold tabular-nums" data-testid="deal-diff">
              {dealDiffText(deal, money)}
            </span>
          </div>
          <p className="text-sm font-semibold" data-testid="deal-pay-up-to">Pay up to {money(deal.payUpTo)}</p>
          {deal.notes.map((note) => <p key={note} className="text-xs font-medium opacity-90">{note}</p>)}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  )
}

export function DealPriceInput({ value, onChange, label = "Asking price", autoFocus = true }: { value: string; onChange: (next: string) => void; label?: string; autoFocus?: boolean }) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!autoFocus) return
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
    return () => window.cancelAnimationFrame(frame)
  }, [autoFocus])
  return (
    <>
      <label className="mb-2 flex h-12 items-center gap-2 rounded-2xl border border-border/70 bg-background px-4 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
        <span className="text-sm font-semibold text-muted-foreground">{label.replace(" price", "")}</span>
        <input
          ref={inputRef}
          aria-label={label}
          inputMode="decimal"
          enterKeyHint="done"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, "").slice(0, 9))}
          onKeyDown={(event) => {
            // "Done" closes the keyboard so the card actions come back into view.
            if (event.key === "Enter") event.currentTarget.blur()
          }}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-right text-2xl font-black tabular-nums outline-none"
        />
        <button type="button" aria-label="Done editing price" onPointerDown={event => event.preventDefault()} onClick={() => inputRef.current?.blur()} className={`min-h-9 min-w-9 items-center justify-center text-xs font-semibold ${SHOW_WHILE_TYPING}`}>Done</button>
      </label>
    </>
  )
}
