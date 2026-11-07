"use client"

import { useState } from "react"
import { useShowBudget } from "@/hooks/use-show-budget"
import { useShowSession } from "@/hooks/use-show-session"
import { summarizeShowBudget } from "@/lib/show-budget"
import { parseAskingPrice } from "@/lib/deal-check"
import { formatMoney } from "@/lib/regional-price"
import { DISPLAY_CURRENCIES, type DisplayCurrency } from "@/lib/pricing-region"

export default function ShowBudget({ storageKey, currency, compact = false }: { storageKey: string; currency: DisplayCurrency; compact?: boolean }) {
  const { budget, write, error } = useShowBudget(storageKey)
  const { session } = useShowSession()
  const [editing, setEditing] = useState(false)
  const [input, setInput] = useState("")
  const [chosenCurrency, setChosenCurrency] = useState(currency)
  const summary = budget ? summarizeShowBudget(budget, session) : null
  const amount = parseAskingPrice(input)
  if (compact && !budget) return null
  return <section aria-label="Show budget" className={compact ? "py-1 text-sm" : "holo-panel mb-3 rounded-3xl border border-border/60 p-3 text-sm"}>
    {budget && summary && <p role="status" className={summary.remaining < 0 ? "font-semibold text-amber-700 dark:text-amber-300" : "font-semibold"}>{formatMoney(Math.abs(summary.remaining), budget.currency)} {summary.remaining < 0 ? "over budget" : "left"} · {formatMoney(summary.spent, budget.currency)} spent</p>}
    {summary?.excludedCount ? <p className="text-xs text-muted-foreground">{summary.excludedCount} purchase{summary.excludedCount === 1 ? "" : "s"} in other currencies excluded.</p> : null}
    {!compact && <>
      <p className="text-xs text-muted-foreground">This device&apos;s limit · current show&apos;s shared spending</p>
      {editing ? <form className="mt-2 space-y-2" onSubmit={event => { event.preventDefault(); if (amount && write({ limit: amount, currency: chosenCurrency })) setEditing(false) }}>
        <div className="flex gap-2">
          <label className="min-w-0 flex-1">Spending limit<input aria-label="Spending limit" inputMode="decimal" value={input} onChange={event => setInput(event.target.value)} className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-2 text-base" /></label>
          <label>Currency<select aria-label="Budget currency" value={chosenCurrency} onChange={event => setChosenCurrency(event.target.value as DisplayCurrency)} className="mt-1 block h-11 rounded-lg border border-border bg-background px-2 text-base">{DISPLAY_CURRENCIES.map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <button type="submit" disabled={!amount} className="holo-action min-h-10 rounded-full px-4 font-semibold disabled:opacity-50">Save budget</button>
        <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl px-3">Cancel</button>
      </form> : <button type="button" className="min-h-10 rounded-xl px-3 font-semibold" onClick={() => { setInput(budget ? String(budget.limit) : ""); setChosenCurrency(budget?.currency ?? currency); setEditing(true) }}>{budget ? "Edit budget" : "Set show budget"}</button>}
      {budget && <button type="button" className="min-h-10 rounded-xl px-3" onClick={() => { if (write(null)) setEditing(false) }}>Clear budget</button>}
    </>}
    {error && <p role="alert" className="text-sm">{error}</p>}
  </section>
}
