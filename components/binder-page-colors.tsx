'use client';

import { useCallback, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BINDER_COLOR_PRESETS, getBinderColorPreset, isCustomBinderColor, type BinderColor } from '@/lib/binder-colors';

/** Extra quick picks, close to common zip-binder colours. Saved as custom hex, so they need no preset theme. */
const EXTRA_SWATCHES: Array<{ label: string; hex: BinderColor }> = [
  { label: 'Red', hex: '#c4262e' },
  { label: 'Orange', hex: '#e8742a' },
  { label: 'Pastel yellow', hex: '#f3e29a' },
  { label: 'Mint', hex: '#8fd6b8' },
  { label: 'Teal', hex: '#0f7c80' },
  { label: 'Pastel blue', hex: '#a9cbea' },
  { label: 'Navy', hex: '#1f2a4d' },
  { label: 'Purple', hex: '#6a3fb0' },
  { label: 'Pink', hex: '#e86a9a' },
  { label: 'Neon pink', hex: '#ff3fa4' },
  { label: 'Neon orange', hex: '#ff6a1a' },
  { label: 'Neon blue', hex: '#1e9bff' },
];

const swatchHex = (color: BinderColor) => getBinderColorPreset(color).swatch[0].toLowerCase();
/** Dark text on light pages, light text on dark ones. */
const inkFor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)';
};

/** Drag across a strip of the binder's pages to pick a run (or type From/To), then tap a preset or pick any
 * custom colour. Changes apply at once. */
export function BinderPageColors({
  totalPages,
  currentPage,
  binderColor,
  pageColors,
  disabled,
  onSetBinderColor,
  onSetPagesColor,
}: {
  totalPages: number;
  currentPage: number;
  binderColor: BinderColor;
  pageColors: Record<string, BinderColor>;
  disabled: boolean;
  onSetBinderColor: (color: BinderColor) => void;
  /** `null` resets the pages to the binder colour. */
  onSetPagesColor: (color: BinderColor | null, pages: number[]) => void;
}) {
  const clamp = (page: number) => Math.min(Math.max(Math.round(page), 1), totalPages);
  const here = clamp(currentPage);
  // The anchor is where a drag started; the run is anchor..end in either direction.
  const [range, setRange] = useState({ anchor: here, end: here });
  const from = Math.min(range.anchor, range.end);
  const to = Math.max(range.anchor, range.end);
  const selected = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const allSelected = from === 1 && to === totalPages;
  const colorOf = (page: number) => pageColors[String(page)] ?? binderColor;
  const selectedHexes = new Set(selected.map((page) => swatchHex(colorOf(page))));
  const activeHex = allSelected ? swatchHex(binderColor) : selectedHexes.size === 1 ? [...selectedHexes][0] : null;
  const hasOverrides = selected.some((page) => pageColors[String(page)] !== undefined);
  // In-progress edits; null shows the selected pages' values.
  const [picking, setPicking] = useState<string | null>(null);
  const [typed, setTyped] = useState<{ hex?: string; from?: string; to?: string }>({});
  const draft = picking ?? activeHex ?? '#000000';
  const hexInput = typed.hex ?? activeHex ?? '';

  const apply = useCallback(
    (color: BinderColor) => {
      if (disabled) return;
      if (from === 1 && to === totalPages) onSetBinderColor(color);
      else
        onSetPagesColor(
          color,
          Array.from({ length: to - from + 1 }, (_, i) => from + i),
        );
    },
    [disabled, from, to, totalPages, onSetBinderColor, onSetPagesColor],
  );
  // `change` fires once the native picker closes; React's onChange fires on every drag step, which would save each one.
  const pickerRef = useCallback(
    (input: HTMLInputElement | null) => {
      if (!input) return;
      const commit = () => {
        apply(input.value.toLowerCase() as BinderColor);
        setPicking(null);
      };
      input.addEventListener('change', commit);
      return () => input.removeEventListener('change', commit);
    },
    [apply, setPicking],
  );
  const pageAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return clamp(Math.floor(((event.clientX - box.left) / box.width) * totalPages) + 1);
  };
  const target = allSelected ? 'Whole binder' : from === to ? `Page ${from}` : `Pages ${from}–${to}`;
  const commitHex = () => {
    const value = hexInput.trim().startsWith('#') ? hexInput.trim() : `#${hexInput.trim()}`;
    if (isCustomBinderColor(value)) apply(value.toLowerCase() as BinderColor);
    setTyped({});
  };
  const commitBound = (which: 'from' | 'to', value: string | undefined) => {
    const page = Number.parseInt(value ?? '', 10);
    if (Number.isFinite(page))
      setRange(
        which === 'from'
          ? { anchor: clamp(page), end: Math.max(clamp(page), to) }
          : { anchor: from, end: Math.max(clamp(page), from) },
      );
    setTyped({});
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">Page colours</p>
          <p className="text-muted-foreground text-xs">Drag across pages to pick a run</p>
        </div>
        <div
          aria-hidden
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const page = pageAt(event);
            setRange({ anchor: page, end: page });
          }}
          onPointerMove={(event) => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const page = pageAt(event);
            setRange((current) => (current.end === page ? current : { ...current, end: page }));
          }}
          className="ring-border/50 relative flex h-12 cursor-pointer touch-none overflow-hidden rounded-xl ring-1 select-none"
        >
          {Array.from({ length: totalPages }, (_, i) => (
            <span key={i} className="h-full flex-1" style={{ background: swatchHex(colorOf(i + 1)) }} />
          ))}
          <span
            className="border-primary bg-primary/15 pointer-events-none absolute inset-y-0 rounded-lg border-2"
            style={{ left: `${((from - 1) / totalPages) * 100}%`, width: `${((to - from + 1) / totalPages) * 100}%` }}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">From</span>
          <Input
            aria-label="From page"
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={typed.from ?? String(from)}
            onChange={(event) => setTyped({ from: event.target.value })}
            onBlur={() => commitBound('from', typed.from)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitBound('from', typed.from);
            }}
            className="w-16 tabular-nums"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <Input
            aria-label="To page"
            type="number"
            inputMode="numeric"
            min={1}
            max={totalPages}
            value={typed.to ?? String(to)}
            onChange={(event) => setTyped({ to: event.target.value })}
            onBlur={() => commitBound('to', typed.to)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitBound('to', typed.to);
            }}
            className="w-16 tabular-nums"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto shrink-0 rounded-full"
            onClick={() => setRange(allSelected ? { anchor: here, end: here } : { anchor: 1, end: totalPages })}
          >
            {allSelected ? `Page ${here}` : 'All pages'}
          </Button>
        </div>
      </div>

      <div className="border-border/40 space-y-3 border-t pt-4">
        <p className="text-sm font-medium">{target}</p>
        <div role="group" aria-label="Colours" className="flex flex-wrap gap-2">
          {[
            ...BINDER_COLOR_PRESETS.map((preset) => ({
              id: preset.id as BinderColor,
              label: preset.label,
              hex: preset.swatch[0].toLowerCase(),
              background: `linear-gradient(135deg, ${preset.swatch[0]} 0%, ${preset.swatch[1]} 100%)`,
            })),
            ...EXTRA_SWATCHES.map((swatch) => ({
              id: swatch.hex,
              label: swatch.label,
              hex: swatch.hex,
              background: swatch.hex,
            })),
          ].map((swatch) => {
            const isActive = activeHex === swatch.hex;
            return (
              <button
                key={swatch.id}
                type="button"
                aria-label={swatch.label}
                aria-pressed={isActive}
                title={swatch.label}
                disabled={disabled}
                onClick={() => apply(swatch.id)}
                style={{ background: swatch.background }}
                className="ring-border/50 flex size-10 items-center justify-center rounded-full ring-1 disabled:opacity-40"
              >
                {isActive && <Check className="size-4" style={{ color: inkFor(swatch.hex) }} aria-hidden />}
              </button>
            );
          })}
          <label
            title="Custom colour"
            className={`ring-border/50 relative flex size-10 items-center justify-center overflow-hidden rounded-full ring-1 ${
              disabled ? 'opacity-40' : 'cursor-pointer'
            }`}
            style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
          >
            <Pipette className="size-4 text-white drop-shadow" aria-hidden />
            <input
              ref={pickerRef}
              type="color"
              aria-label="Custom colour"
              value={draft}
              disabled={disabled}
              onChange={(event) => setPicking(event.target.value)}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="ring-border/50 size-9 shrink-0 rounded-xl ring-1"
            style={{ background: draft }}
            aria-hidden
          />
          <Input
            aria-label="Hex colour"
            value={hexInput}
            placeholder="#1c6b43"
            maxLength={7}
            spellCheck={false}
            autoCapitalize="off"
            disabled={disabled}
            onChange={(event) => setTyped({ hex: event.target.value })}
            onBlur={commitHex}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitHex();
            }}
            className="font-mono"
          />
        </div>
        {!allSelected && hasOverrides && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground px-0"
            disabled={disabled}
            onClick={() => onSetPagesColor(null, selected)}
          >
            Reset to binder colour
          </Button>
        )}
      </div>
    </div>
  );
}
