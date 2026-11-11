'use client';

// Settings › Display › Card show mode: the deal checker's thresholds and this show's purchase tally.
import { useState } from 'react';
import { useShowSession } from '@/hooks/use-show-session';
import {
  DEFAULT_DEAL_THRESHOLDS,
  normalizeDealThresholds,
  readDealThresholds,
  writeDealThresholds,
  type DealThresholds,
} from '@/lib/deal-check';
import { summarizeShowSession } from '@/lib/show-session';
import { formatMoney } from '@/lib/regional-price';

const FIELDS: Array<{ key: keyof DealThresholds; label: string; hint: string }> = [
  { key: 'greatPct', label: 'Great deal', hint: '% or more under market' },
  { key: 'fairPct', label: 'Fair price', hint: '± % around market' },
  { key: 'walkAwayPct', label: 'Walk away', hint: '% or more over market' },
];

export function DealThresholdSettings() {
  const [saved, setSaved] = useState<DealThresholds>(() =>
    readDealThresholds(typeof window === 'undefined' ? undefined : window.localStorage),
  );
  const [draft, setDraft] = useState<Record<keyof DealThresholds, string>>(() => ({
    greatPct: String(saved.greatPct),
    fairPct: String(saved.fairPct),
    walkAwayPct: String(saved.walkAwayPct),
  }));

  const commit = (next: Record<keyof DealThresholds, string>) => {
    const normalized = normalizeDealThresholds({
      greatPct: Number(next.greatPct),
      fairPct: Number(next.fairPct),
      walkAwayPct: Number(next.walkAwayPct),
    });
    writeDealThresholds(window.localStorage, normalized);
    setSaved(normalized);
    setDraft({
      greatPct: String(normalized.greatPct),
      fairPct: String(normalized.fairPct),
      walkAwayPct: String(normalized.walkAwayPct),
    });
  };

  const isDefault =
    saved.greatPct === DEFAULT_DEAL_THRESHOLDS.greatPct &&
    saved.fairPct === DEFAULT_DEAL_THRESHOLDS.fairPct &&
    saved.walkAwayPct === DEFAULT_DEAL_THRESHOLDS.walkAwayPct;

  return (
    <div
      className="border-border/50 bg-muted/35 space-y-2 rounded-2xl border px-4 py-3"
      role="group"
      aria-label="Deal checker"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-1">
          <p className="text-sm font-medium">Deal checker</p>
          <p className="text-muted-foreground text-xs">
            How an asking price compares with the market price. Between Fair and Walk away is Overpriced; between Fair
            and Great is Good.
          </p>
        </div>
        {!isDefault && (
          <button
            type="button"
            className="text-primary hover:bg-primary/10 h-9 shrink-0 rounded-full px-3 text-xs font-semibold"
            onClick={() =>
              commit({
                greatPct: String(DEFAULT_DEAL_THRESHOLDS.greatPct),
                fairPct: String(DEFAULT_DEAL_THRESHOLDS.fairPct),
                walkAwayPct: String(DEFAULT_DEAL_THRESHOLDS.walkAwayPct),
              })
            }
          >
            Reset
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs">
            <span className="font-semibold">{field.label}</span>
            <span className="border-border/70 bg-background focus-within:border-primary flex h-11 items-center rounded-xl border px-2">
              <input
                aria-label={`${field.label} threshold`}
                inputMode="numeric"
                value={draft[field.key]}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.target.value.replace(/\D/g, '').slice(0, 3),
                  }))
                }
                onBlur={() => commit(draft)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commit(draft);
                }}
                className="w-full min-w-0 bg-transparent text-right text-base font-bold tabular-nums outline-none"
              />
              <span className="text-muted-foreground pl-0.5">%</span>
            </span>
            <span className="text-muted-foreground text-[10px] leading-tight">{field.hint}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ShowTallySettings() {
  const { session, clear } = useShowSession();
  const currency = session.purchases.at(-1)?.currency as Parameters<typeof formatMoney>[1] | undefined;
  if (!currency) return null;
  const summary = summarizeShowSession(session, currency);
  return (
    <div
      className="border-border/50 bg-muted/35 flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
      data-testid="show-tally-settings"
    >
      <div className="space-y-1">
        <p className="text-sm font-medium">This show</p>
        <p className="text-muted-foreground text-xs">
          {summary.count} bought · {formatMoney(summary.spent, currency)} spent
          {summary.marketValue > 0 ? ` · market ${formatMoney(summary.marketValue, currency)}` : ''}. Starts again after
          a day; saved to your account. Clear resets it on this device.
        </p>
      </div>
      <button
        type="button"
        onClick={clear}
        className="border-border/70 h-10 shrink-0 rounded-full border px-3 text-xs font-semibold"
      >
        Clear
      </button>
    </div>
  );
}
