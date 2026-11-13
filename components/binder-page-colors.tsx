'use client';

import { useCallback, useState } from 'react';
import { Check, Pipette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BINDER_COLOR_PRESETS, getBinderColorPreset, isCustomBinderColor, type BinderColor } from '@/lib/binder-colors';

const swatchHex = (color: BinderColor) => getBinderColorPreset(color).swatch[0].toLowerCase();
/** Dark text on light pages, light text on dark ones. */
const inkFor = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return r * 0.299 + g * 0.587 + b * 0.114 > 150 ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.92)';
};

/** Pick pages in a grid of page chips, then tap a preset or pick any custom colour. Changes apply at once. */
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
  const [selected, setSelected] = useState(() => new Set([Math.min(Math.max(currentPage, 1), totalPages)]));
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const allSelected = selected.size === totalPages;
  const colorOf = (page: number) => pageColors[String(page)] ?? binderColor;
  const selectedHexes = new Set([...selected].map((page) => swatchHex(colorOf(page))));
  const activeHex = allSelected ? swatchHex(binderColor) : selectedHexes.size === 1 ? [...selectedHexes][0] : null;
  const hasOverrides = [...selected].some((page) => pageColors[String(page)] !== undefined);
  // In-progress edits; null shows the selected pages' colour.
  const [picking, setPicking] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const draft = picking ?? activeHex ?? '#000000';
  const hexInput = typing ?? activeHex ?? '';

  const apply = useCallback(
    (color: BinderColor) => {
      if (disabled || selected.size === 0) return;
      if (selected.size === totalPages) onSetBinderColor(color);
      else onSetPagesColor(color, [...selected]);
    },
    [disabled, selected, totalPages, onSetBinderColor, onSetPagesColor],
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
  const toggle = (page: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  const target =
    selected.size === 0
      ? 'Choose pages'
      : allSelected
        ? 'Whole binder'
        : selected.size === 1
          ? `Page ${[...selected][0]}`
          : `${selected.size} pages`;
  const commitHex = () => {
    const value = hexInput.trim().startsWith('#') ? hexInput.trim() : `#${hexInput.trim()}`;
    if (isCustomBinderColor(value)) apply(value.toLowerCase() as BinderColor);
    setTyping(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Page colours</p>
          <p className="text-muted-foreground text-xs">Tap pages, then pick a colour.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="shrink-0 rounded-full"
          onClick={() => setSelected(allSelected ? new Set() : new Set(pages))}
        >
          {allSelected ? 'Clear' : 'Select all'}
        </Button>
      </div>
      <div role="group" aria-label="Pages" className="grid grid-cols-8 gap-1.5">
        {pages.map((page) => {
          const hex = swatchHex(colorOf(page));
          const isSelected = selected.has(page);
          return (
            <button
              key={page}
              type="button"
              aria-pressed={isSelected}
              aria-label={`Page ${page}${pageColors[String(page)] ? ', own colour' : ''}`}
              onClick={() => toggle(page)}
              style={{ background: hex, color: inkFor(hex) }}
              className={`relative flex h-10 items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-shadow ${
                isSelected ? 'ring-primary ring-offset-background ring-2 ring-offset-2' : 'ring-border/50 ring-1'
              }`}
            >
              {page}
              {pageColors[String(page)] && (
                <span className="absolute top-1 right-1 size-1.5 rounded-full bg-current opacity-70" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      <div className="border-border/40 space-y-3 border-t pt-4">
        <p className="text-sm font-medium">{target}</p>
        <div role="group" aria-label="Colours" className="flex flex-wrap gap-2">
          {BINDER_COLOR_PRESETS.map((preset) => {
            const isActive = activeHex === preset.swatch[0].toLowerCase();
            return (
              <button
                key={preset.id}
                type="button"
                aria-label={preset.label}
                aria-pressed={isActive}
                title={preset.label}
                disabled={disabled || selected.size === 0}
                onClick={() => apply(preset.id)}
                style={{ background: `linear-gradient(135deg, ${preset.swatch[0]} 0%, ${preset.swatch[1]} 100%)` }}
                className="ring-border/50 flex size-10 items-center justify-center rounded-full ring-1 disabled:opacity-40"
              >
                {isActive && <Check className="size-4" style={{ color: inkFor(preset.swatch[0]) }} aria-hidden />}
              </button>
            );
          })}
          <label
            title="Custom colour"
            className={`ring-border/50 relative flex size-10 items-center justify-center overflow-hidden rounded-full ring-1 ${
              disabled || selected.size === 0 ? 'opacity-40' : 'cursor-pointer'
            }`}
            style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
          >
            <Pipette className="size-4 text-white drop-shadow" aria-hidden />
            <input
              ref={pickerRef}
              type="color"
              aria-label="Custom colour"
              value={draft}
              disabled={disabled || selected.size === 0}
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
            disabled={disabled || selected.size === 0}
            onChange={(event) => setTyping(event.target.value)}
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
            onClick={() => onSetPagesColor(null, [...selected])}
          >
            Reset to binder colour
          </Button>
        )}
      </div>
    </div>
  );
}
