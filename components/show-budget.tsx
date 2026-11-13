'use client';

import { useState } from 'react';
import { useShowBudget } from '@/hooks/use-show-budget';
import { useShowSession } from '@/hooks/use-show-session';
import { summarizeShowBudget } from '@/lib/show-budget';
import { parseAskingPrice } from '@/lib/deal-check';
import { formatMoney } from '@/lib/regional-price';
import { DISPLAY_CURRENCIES, type DisplayCurrency } from '@/lib/pricing-region';
import { Select } from '@/components/ui/select';

export default function ShowBudget({
  storageKey,
  currency,
  compact = false,
}: {
  storageKey: string;
  currency: DisplayCurrency;
  compact?: boolean;
}) {
  const { budget, write, error } = useShowBudget(storageKey);
  const { session } = useShowSession();
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  // oxlint-disable-next-line react-doctor/no-derived-useState -- draft currency for the edit form, seeded from the prop on purpose
  const [chosenCurrency, setChosenCurrency] = useState(currency);
  const summary = budget ? summarizeShowBudget(budget, session) : null;
  const amount = parseAskingPrice(input);
  if (compact && !budget) return null;
  return (
    <section
      aria-label="Show budget"
      className={compact ? 'py-1 text-sm' : 'holo-panel border-border/60 mb-3 rounded-3xl border p-3 text-sm'}
    >
      {budget && summary && (
        <p
          role="status"
          className={summary.remaining < 0 ? 'font-semibold text-amber-700 dark:text-amber-300' : 'font-semibold'}
        >
          {formatMoney(Math.abs(summary.remaining), budget.currency)} {summary.remaining < 0 ? 'over budget' : 'left'} ·{' '}
          {formatMoney(summary.spent, budget.currency)} spent
        </p>
      )}
      {summary?.excludedCount ? (
        <p className="text-muted-foreground text-xs">
          {summary.excludedCount} purchase{summary.excludedCount === 1 ? '' : 's'} in other currencies excluded.
        </p>
      ) : null}
      {!compact && (
        <>
          <p className="text-muted-foreground text-xs">
            This device&apos;s limit · current show&apos;s shared spending
          </p>
          {editing ? (
            // oxlint-disable-next-line react-doctor/no-prevent-default -- client-only form that works on the device; there is no server action to post to
            <form
              className="mt-2 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (amount && write({ limit: amount, currency: chosenCurrency })) setEditing(false);
              }}
            >
              <div className="flex gap-2">
                <label className="min-w-0 flex-1">
                  Spending limit
                  <input
                    aria-label="Spending limit"
                    inputMode="decimal"
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    className="border-border bg-background mt-1 h-11 w-full rounded-lg border px-2 text-base"
                  />
                </label>
                <label>
                  Currency
                  <Select
                    aria-label="Budget currency"
                    value={chosenCurrency}
                    onChange={(event) => setChosenCurrency(event.target.value as DisplayCurrency)}
                    className="mt-1 flex"
                  >
                    {DISPLAY_CURRENCIES.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </Select>
                </label>
              </div>
              <button
                type="submit"
                disabled={!amount}
                className="holo-action min-h-10 rounded-full px-4 font-semibold disabled:opacity-50"
              >
                Save budget
              </button>
              <button type="button" onClick={() => setEditing(false)} className="min-h-10 rounded-xl px-3">
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="min-h-10 rounded-xl px-3 font-semibold"
              onClick={() => {
                setInput(budget ? String(budget.limit) : '');
                setChosenCurrency(budget?.currency ?? currency);
                setEditing(true);
              }}
            >
              {budget ? 'Edit budget' : 'Set show budget'}
            </button>
          )}
          {budget && (
            <button
              type="button"
              className="min-h-10 rounded-xl px-3"
              onClick={() => {
                if (write(null)) setEditing(false);
              }}
            >
              Clear budget
            </button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
