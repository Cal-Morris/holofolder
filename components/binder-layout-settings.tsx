'use client';

import { useState } from 'react';
import { BINDER_SIZES, isBinderGridSize, isPresetBinderLayout, MAX_BINDER_GRID_SIZE } from '@/lib/binder-layout';
import { useBillingContext } from '@/hooks/use-billing';

export function BinderLayoutSettings({
  rows,
  cols,
  readOnly,
  onChange,
}: {
  rows: number;
  cols: number;
  readOnly: boolean;
  /** Resolves false when nothing changed (a native binder's warning was dismissed). */
  onChange: (rows: number, cols: number) => void | boolean | Promise<void | boolean>;
}) {
  const billing = useBillingContext();
  const [customRows, setCustomRows] = useState(String(rows));
  const [customCols, setCustomCols] = useState(String(cols));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valid = isBinderGridSize(Number(customRows)) && isBinderGridSize(Number(customCols));
  const apply = async (nextRows: number, nextCols: number) => {
    setBusy(true);
    setMessage(null);
    try {
      if ((await onChange(nextRows, nextCols)) === false) return;
      setCustomRows(String(nextRows));
      setCustomCols(String(nextCols));
      setMessage(navigator.onLine ? 'Layout saved.' : 'Saved on this device. Will sync when you’re online.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the layout.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {BINDER_SIZES.map((size) => (
          <button
            key={size.label}
            type="button"
            aria-pressed={rows === size.rows && cols === size.cols}
            onClick={() => void apply(size.rows, size.cols)}
            disabled={readOnly || busy}
            className={`min-h-14 rounded-2xl border-2 px-3 py-3 text-sm font-medium transition-colors disabled:opacity-50 ${rows === size.rows && cols === size.cols ? 'border-primary bg-primary/10 text-primary' : 'border-border/50 bg-muted/50 text-muted-foreground hover:border-primary/50 hover:text-foreground'}`}
          >
            <span className="text-lg font-bold">{size.label}</span>
            <span className="block text-[10px] opacity-70">{size.rows * size.cols} slots</span>
          </button>
        ))}
      </div>
      {!readOnly && (
        <div className="border-border/60 space-y-3 rounded-2xl border p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Custom layout</h4>
            <span className="text-primary text-xs font-medium">Premium</span>
          </div>
          {billing?.premium ? (
            // oxlint-disable-next-line react-doctor/no-prevent-default -- client-only PWA: this form is handled on the device (offline queue and validation), so it can't fall back to a server action
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (valid && !busy) void apply(Number(customRows), Number(customCols));
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  Rows
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_BINDER_GRID_SIZE}
                    step={1}
                    value={customRows}
                    onChange={(event) => setCustomRows(event.target.value)}
                    className="border-border bg-background block h-11 w-full rounded-xl border px-3 text-base"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  Columns
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={MAX_BINDER_GRID_SIZE}
                    step={1}
                    value={customCols}
                    onChange={(event) => setCustomCols(event.target.value)}
                    className="border-border bg-background block h-11 w-full rounded-xl border px-3 text-base"
                    required
                  />
                </label>
              </div>
              <p className="text-muted-foreground text-xs">
                1–8 rows and columns{valid ? ` · ${Number(customRows) * Number(customCols)} slots per page` : ''}. Large
                pages scroll to keep cards easy to tap.
              </p>
              <button
                type="submit"
                disabled={!valid || busy}
                className="bg-primary text-primary-foreground min-h-11 w-full rounded-xl px-3 text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Apply layout'}
              </button>
            </form>
          ) : (
            <>
              <p className="text-muted-foreground text-xs">
                Choose your own dimensions, up to 8×8 with 64 slots per page.
              </p>
              {!isPresetBinderLayout(rows, cols) && (
                <p className="text-muted-foreground text-xs">
                  Your saved {rows}×{cols} layout stays available.
                </p>
              )}
              <button
                type="button"
                disabled={billing?.loading}
                onClick={() => billing?.upgrade()}
                className="border-primary/40 text-primary min-h-11 w-full rounded-xl border px-3 text-sm font-semibold"
              >
                {billing?.loading ? 'Checking plan…' : 'Upgrade for custom layouts'}
              </button>
            </>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-muted-foreground text-xs">
          {message}
        </p>
      )}
      {readOnly && (
        <p className="text-muted-foreground text-center text-xs">Shared binders keep the owner&apos;s saved layout.</p>
      )}
    </div>
  );
}
