"use client"

// The asking-price keypad and verdict panel shared by Show mode's card check and bundle check.
import { useEffect, useRef } from "react"
import type { DealCheck, DealVerdict } from "@/lib/deal-check"

export const DEAL_VERDICT_TONE: Record<DealVerdict, string> = {
  great: "bg-emerald-600 text-white",
  good: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  fair: "bg-sky-500/15 text-sky-800 dark:text-sky-300",
  overpriced: "bg-amber-500/20 text-amber-900 dark:text-amber-300",
  "walk-away": "bg-red-600 text-white",
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "⌫"] as const

/** Applies a keypad press to the typed amount: one decimal point, two decimals, eight characters. */
export function pressDealKey(current: string, key: string) {
  if (key === "⌫") return current.slice(0, -1)
  if (key === "." && current.includes(".")) return current
  if (/\.\d{2}$/.test(current) || current.length >= 8) return current
  return current === "" && key === "." ? "0." : current + key
}

export function DealVerdictPanel({ deal, money, emptyText, testId = "deal-verdict" }: { deal: DealCheck | null; money: (amount: number) => string; emptyText: string; testId?: string }) {
  return (
    <div
      className={`rounded-2xl px-3 py-3 ${deal ? DEAL_VERDICT_TONE[deal.verdict] : "border border-dashed border-border/70"}`}
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
              {deal.diffPct === 0 ? "At market" : `${Math.abs(deal.diffPct)}% ${deal.diffPct < 0 ? "under" : "over"}`} · {deal.diffAmount < 0 ? "−" : "+"}{money(Math.abs(deal.diffAmount))}
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

export function DealKeypad({ value, onChange, label = "Asking price", autoFocus = true }: { value: string; onChange: (next: string) => void; label?: string; autoFocus?: boolean }) {
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
          // The keypad below is the keyboard: focus without raising the phone's own (typing still works).
          inputMode="none"
          enterKeyHint="done"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, "").slice(0, 9))}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent text-right text-2xl font-black tabular-nums outline-none"
        />
      </label>
      <div className="mb-2 grid grid-cols-6 gap-1.5" role="group" aria-label="Keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              navigator.vibrate?.(8)
              onChange(pressDealKey(value, key))
            }}
            aria-label={key === "⌫" ? "Delete digit" : key === "." ? "Decimal point" : key}
            className="h-12 rounded-xl bg-muted/70 text-lg font-bold active:bg-muted"
          >
            {key}
          </button>
        ))}
      </div>
    </>
  )
}
