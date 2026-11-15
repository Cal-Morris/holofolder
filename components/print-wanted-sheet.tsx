'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { OverlayCloseButton, OverlayDialog, OverlayFooter, OverlayHeader } from '@/components/ui/overlay-dialog';
import { OptionRow } from '@/components/ui/option-row';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { nativeCardConsumers, type NativeConsumerBinding } from '@/lib/collection/native-card-consumers';
import {
  PAPER,
  binderPages,
  binderSheets,
  binderWants,
  defaultPaper,
  listSheets,
  placeholderCount,
  toPrintWants,
  type PaperSize,
  type PlaceholderStyle,
} from '@/lib/print-placeholders';
import type { PlaceholderPrintJob } from '@/components/placeholder-print';

const PlaceholderPrint = dynamic(() => import('@/components/placeholder-print'), { ssr: false });

const LIST = 'list';

const group = (legend: string, children: React.ReactNode, className = 'space-y-1.5') => (
  <fieldset>
    <legend className="text-muted-foreground mb-1.5 text-xs font-semibold">{legend}</legend>
    <div className={className}>{children}</div>
  </fieldset>
);

/**
 * Print wanted cards as 63 × 88 mm placeholders for penny sleeves: the want list as shown (packed nine to a page),
 * or a binder's empty wanted pockets in binder order, so each printed page matches its binder page.
 */
export default function PrintWantedSheet({
  binding,
  listKeys,
  initialBinderId,
  onClose,
}: {
  binding: Pick<NativeConsumerBinding, 'scope' | 'read'>;
  /** The want list's entries as shown (search, filters and sort applied). Omit to offer binders only. */
  listKeys?: readonly string[];
  /** The binder to start on when there is no list, usually the open one. */
  initialBinderId?: string | null;
  onClose: () => void;
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent options; React batches the updates and one reducer would not be clearer
}) {
  const model = nativeCardConsumers({ ...binding, collectionId: undefined });
  const wants = model ? toPrintWants(model, binding.read) : [];
  const binders = [...new Map(wants.map((w) => [w.binderId, w.binderName]))].flatMap(([id, name]) => {
    const count = binderWants(wants, id).length;
    return count ? [{ id, name, count }] : [];
  });
  const [source, setSource] = useState(() =>
    listKeys ? LIST : ((binders.find((b) => b.id === initialBinderId) ?? binders[0])?.id ?? LIST),
  );
  const pages = source === LIST ? [] : binderPages(wants, source);
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);
  const from = range && pages.includes(range.from) ? range.from : (pages[0] ?? 1);
  const to = range && pages.includes(range.to) && range.to >= from ? range.to : (pages.at(-1) ?? 1);
  const [style, setStyle] = useState<PlaceholderStyle>('image');
  const [paper, setPaper] = useState<PaperSize>(() =>
    defaultPaper(typeof navigator === 'undefined' ? undefined : navigator.language),
  );
  const [showPosition, setShowPosition] = useState(true);
  const [job, setJob] = useState<(PlaceholderPrintJob & { id: number }) | null>(null);

  const byKey = new Map(wants.map((w) => [w.key, w]));
  const sheets =
    source === LIST
      ? listSheets((listKeys ?? []).flatMap((key) => byKey.get(key) ?? []))
      : binderSheets(wants, source, from, to);
  const count = placeholderCount(sheets);

  return (
    <OverlayDialog
      onClose={onClose}
      aria-label="Print wanted cards"
      className="flex flex-col pr-[env(safe-area-inset-right)] pb-[var(--safe-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <OverlayHeader className="border-b-0 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">Print wanted cards</h2>
        <OverlayCloseButton label="Close print wanted cards" onClick={onClose} className="-mr-2 h-11 w-11" />
      </OverlayHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3">
        <p className="text-muted-foreground text-sm">
          Card-sized placeholders, 63 × 88 mm, to slide into a penny sleeve until you find the real card.
        </p>

        {group(
          'Cards',
          <>
            {listKeys && (
              <OptionRow
                title="Want list as shown"
                detail={`${listKeys.length} ${listKeys.length === 1 ? 'card' : 'cards'}, nine to a page`}
                selected={source === LIST}
                onClick={() => setSource(LIST)}
              />
            )}
            {binders.map((binder) => (
              <OptionRow
                key={binder.id}
                title={binder.name}
                detail={`${binder.count} empty wanted ${binder.count === 1 ? 'pocket' : 'pockets'}, in binder order`}
                selected={source === binder.id}
                onClick={() => setSource(binder.id)}
              />
            ))}
            {!listKeys && binders.length === 0 && (
              <p className="text-muted-foreground text-sm">No empty pockets with a wanted card.</p>
            )}
          </>,
        )}

        {pages.length > 1 &&
          group(
            'Binder pages',
            <>
              <Select
                aria-label="From binder page"
                className="min-w-0 flex-1"
                value={from}
                onChange={(e) => setRange({ from: Number(e.target.value), to: Math.max(to, Number(e.target.value)) })}
              >
                {pages.map((page) => (
                  <option key={page} value={page}>
                    From page {page}
                  </option>
                ))}
              </Select>
              <Select
                aria-label="To binder page"
                className="min-w-0 flex-1"
                value={to}
                onChange={(e) => setRange({ from, to: Number(e.target.value) })}
              >
                {pages.flatMap((page) =>
                  page >= from
                    ? [
                        <option key={page} value={page}>
                          To page {page}
                        </option>,
                      ]
                    : [],
                )}
              </Select>
            </>,
            'flex gap-2',
          )}

        {group(
          'Style',
          <>
            <OptionRow
              title="Card image"
              detail="Offline, cards without a saved image print as outlines"
              selected={style === 'image'}
              onClick={() => setStyle('image')}
            />
            <OptionRow
              title="Ink saver"
              detail="Outline with name, set, number, rarity and illustrator"
              selected={style === 'ink'}
              onClick={() => setStyle('ink')}
            />
          </>,
        )}

        {group(
          'Paper',
          (['a4', 'letter'] as const).map((size) => (
            <OptionRow key={size} title={PAPER[size].label} selected={paper === size} onClick={() => setPaper(size)} />
          )),
          'grid grid-cols-2 gap-1.5',
        )}

        <div className="flex min-h-11 items-center justify-between gap-3">
          <p className="text-sm font-medium">Show binder page and pocket</p>
          <Switch checked={showPosition} onCheckedChange={setShowPosition} aria-label="Show binder page and pocket" />
        </div>

        <p className="text-muted-foreground text-xs">
          Print at 100% (“Actual size”) with scaling off. The first page has a 50 mm line to measure, and thin marks to
          cut along. Each placeholder is labelled, so it can’t pass for a real card.
        </p>
      </div>

      <OverlayFooter className="px-4">
        <Button variant="outline" className="h-11 rounded-2xl" onClick={onClose}>
          Cancel
        </Button>
        <Button
          className="h-11 flex-1 rounded-2xl"
          disabled={count === 0}
          onClick={() => setJob({ id: (job?.id ?? 0) + 1, sheets, paper, style, showPosition })}
        >
          Print {count} {count === 1 ? 'placeholder' : 'placeholders'} · {sheets.length}{' '}
          {sheets.length === 1 ? 'page' : 'pages'}
        </Button>
      </OverlayFooter>
      {job && <PlaceholderPrint key={job.id} job={job} onDone={() => setJob(null)} />}
    </OverlayDialog>
  );
}
