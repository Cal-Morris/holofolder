'use client';

// Import cards from another tracker's CSV (docs/collection-import.md). The file is read on this device; only each
// row's card identity goes to the catalogue lookup. Rows we can't match stay listed and are never guessed.
import { useLayoutEffect, useRef, useState } from 'react';
import { OverlayCloseButton, OverlayDialog, OverlayFooter, OverlayHeader } from '@/components/ui/overlay-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { appPath } from '@/lib/app-path';
import { toCsvField } from '@/lib/collection-export';
import {
  IMPORT_MAX_BYTES,
  IMPORT_SOURCE_NAMES,
  parseImportFile,
  readImportRows,
  type ImportLookup,
  type ImportRow,
  type ImportSource,
} from '@/lib/collection-import';
import type { ImportResolution } from '@/lib/collection-import-resolve';
import { importCatalog, planImport, type ImportCopy } from '@/lib/collection/import-plan';
import type { NativeConsumerBinding } from '@/lib/collection/native-card-consumers';

type Acquire = NonNullable<NativeConsumerBinding['acquire']>;
interface Review {
  source: ImportSource;
  assumedEnglish: boolean;
  copies: ImportCopy[];
  skipped: { row: ImportRow; reason: string }[];
  dropped: string[];
  plan: { filled: number; appended: number; unplaced: number };
}
const plural = (n: number, word: string) => `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}`;

async function resolveLookups(lookups: ImportLookup[], onProgress: (done: number) => void, active: () => boolean) {
  const results = new Map<string, ImportResolution>();
  const chunks: ImportLookup[][] = [];
  for (let i = 0; i < lookups.length; i += 25) chunks.push(lookups.slice(i, i + 25));
  let next = 0;
  // Three requests at a time keeps a 5,000-row file quick without hammering the catalogue.
  const worker = async () => {
    while (next < chunks.length && active()) {
      const chunk = chunks[next++];
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- each worker sends its chunks one after another
      const response = await fetch(appPath('/api/collection-import/resolve'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lookups: chunk }),
      });
      const body = (await response.json().catch(() => null)) as { results?: ImportResolution[]; error?: string } | null;
      if (!response.ok || !body?.results)
        throw new Error(body?.error ?? 'Couldn’t reach the card catalogue. Try again.');
      chunk.forEach((lookup, i) => results.set(JSON.stringify(lookup), body.results![i]));
      onProgress(results.size);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return results;
}

function reportCsv(skipped: Review['skipped']) {
  const rows = [['Line', 'Card', 'Why it wasn’t imported'], ...skipped.map((s) => [s.row.row, s.row.label, s.reason])];
  return rows.map((row) => row.map(toCsvField).join(',')).join('\r\n') + '\r\n';
}

export default function NativeImport({
  acquire,
  collectionId,
  binderName,
  onClose,
}: {
  acquire: Acquire;
  collectionId: string;
  binderName: string;
  onClose: () => void;
}) {
  const alive = useRef(true),
    generation = useRef(0);
  const latest = useRef(acquire);
  useLayoutEffect(() => {
    latest.current = acquire;
  });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  const plan = (copies: ImportCopy[]) => {
    const admission = latest.current();
    if (!admission || admission.read.evidence.kind === 'unavailable')
      throw new Error('Your binder isn’t ready yet. Close this and try again in a moment.');
    const plan = planImport({
      snapshot: admission.read.evidence.snapshot,
      collectionId,
      copies,
      context: admission.context,
    });
    return { admission, plan };
  };

  async function readFile(file: File) {
    const request = ++generation.current;
    const active = () => alive.current && generation.current === request;
    setBusy(true);
    setMessage('');
    setReview(null);
    try {
      if (file.size > IMPORT_MAX_BYTES) throw new Error('That file is over 10 MB.');
      const document = parseImportFile(await file.text());
      const { source, rows } = readImportRows(document);
      const lookups = [
        ...new Map(rows.flatMap((r) => (r.lookup ? [[JSON.stringify(r.lookup), r.lookup] as const] : []))).values(),
      ];
      if (lookups.length && !navigator.onLine)
        throw new Error('You need to be online to match cards to our catalogue.');
      setProgress({ done: 0, total: lookups.length });
      const resolved = await resolveLookups(
        lookups,
        (done) => active() && setProgress({ done, total: lookups.length }),
        active,
      );
      if (!active()) return;
      const copies: ImportCopy[] = [];
      const skipped: Review['skipped'] = [];
      for (const row of rows) {
        const result = row.lookup ? resolved.get(JSON.stringify(row.lookup)) : undefined;
        if (row.problem || !row.lookup || !result || 'problem' in result) {
          skipped.push({
            row,
            reason: row.problem ?? (result && 'problem' in result ? result.problem : 'Not looked up.'),
          });
          continue;
        }
        for (let n = 0; n < row.quantity; n++)
          copies.push({
            card: result.card,
            language: row.lookup.language,
            finish: result.finish,
            grading: row.grading,
          });
      }
      if (copies.length > 5000) throw new Error('That’s more than 5,000 cards. Split the file and import it in parts.');
      const { plan: planned } = plan(copies);
      setReview({
        source,
        assumedEnglish: source === 'generic' && document.mapping.language === undefined,
        copies,
        skipped,
        dropped: [...new Set(rows.flatMap((r) => r.dropped))],
        plan: { filled: planned.filled, appended: planned.appended, unplaced: planned.unplaced },
      });
    } catch (error) {
      if (active()) setMessage(error instanceof Error ? error.message : 'Couldn’t read that file.');
    } finally {
      if (active()) {
        setBusy(false);
        setProgress(null);
      }
    }
  }

  async function addCards() {
    if (!review) return;
    setBusy(true);
    setMessage('');
    try {
      // Planned again on what this device shows now, so edits made since the review are respected.
      const { admission, plan: planned } = plan(review.copies);
      const selected = importCatalog(review.copies);
      for (const intent of planned.intents)
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- each batch is planned on the one before, so they queue in order
        await admission.receive(
          { scope: { ownerUserId: admission.read.scope.ownerUserId, collectionId, slotId: null }, intent },
          selected,
        );
      toast(`Added ${plural(review.copies.length, 'card')} to ${binderName}`);
      onClose();
    } catch (error) {
      if (alive.current) {
        setMessage(
          error instanceof Error ? error.message : 'Couldn’t add the cards. Nothing after the error was added.',
        );
        setBusy(false);
      }
    }
  }

  const download = () => {
    if (!review) return;
    const url = URL.createObjectURL(new Blob([reportCsv(review.skipped)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'holo-folder-import-not-added.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <OverlayDialog
      modal={false}
      portal={false}
      onClose={onClose}
      layerClassName="z-[42] flex items-end justify-center pb-[var(--dock-clearance)] sm:items-center"
      backdropProps={{ className: 'bg-black/50' }}
      aria-label="Import cards"
      className="bg-background relative flex max-h-[calc(100dvh-var(--top-inset)-var(--dock-clearance)-12px)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border shadow-xl sm:rounded-2xl"
    >
      <OverlayHeader className="border-b-0 p-4">
        <h2 className="font-semibold">Import cards</h2>
        <OverlayCloseButton
          label="Close import"
          onClick={onClose}
          className="h-9 w-9 rounded-none hover:bg-transparent"
          iconClassName="h-5 w-5"
        />
      </OverlayHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 text-sm">
        <p>
          Bring your cards over from Collectr, TCG Collector, PriceCharting or a spreadsheet: choose the CSV file you
          exported. The file stays on this device. Only each card&apos;s name, set, number and print are sent to look it
          up.
        </p>
        <input
          aria-label="Select CSV file"
          type="file"
          accept=".csv,text/csv"
          className="block min-h-10 w-full min-w-0 text-sm file:min-h-10"
          disabled={busy}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (file) void readFile(file);
          }}
        />
        {progress && (
          <p role="status">
            Matching cards: {progress.done.toLocaleString('en-GB')} of {progress.total.toLocaleString('en-GB')}
          </p>
        )}
        {review && (
          <section aria-label="Import preview" className="space-y-3 break-words">
            <p className="font-medium">
              {review.source === 'generic' ? 'From a spreadsheet' : `From ${IMPORT_SOURCE_NAMES[review.source]}`}:{' '}
              {plural(review.copies.length, 'card')} ready to add to {binderName}.
            </p>
            {review.copies.length > 0 && (
              <ul className="list-disc space-y-1 pl-5">
                {review.plan.filled > 0 && (
                  <li>
                    {review.plan.filled === 1
                      ? '1 card goes into the pocket made for it'
                      : `${plural(review.plan.filled, 'card')} go into the pockets made for them`}
                  </li>
                )}
                {review.plan.appended > 0 && (
                  <li>
                    {review.plan.appended === 1
                      ? '1 card gets a new pocket at the end of the binder'
                      : `${plural(review.plan.appended, 'card')} get new pockets at the end of the binder`}
                  </li>
                )}
                {review.plan.unplaced > 0 && (
                  <li>
                    {plural(review.plan.unplaced, 'card')} {review.plan.unplaced === 1 ? 'is' : 'are'} kept in your
                    collection without a pocket (second copies and graded cards)
                  </li>
                )}
              </ul>
            )}
            {review.assumedEnglish && <p>The file has no language column, so every card is read as English.</p>}
            {review.dropped.length > 0 && (
              <p className="text-muted-foreground">
                Holo Folder doesn&apos;t keep {review.dropped.join(', ')}, so{' '}
                {review.dropped.length === 1 ? 'it' : 'they'} won&apos;t carry over.
              </p>
            )}
            {review.skipped.length > 0 && (
              <div className="space-y-2">
                <p>
                  {plural(review.skipped.length, 'row')} can&apos;t be imported. Add these cards by hand, or download
                  the list.
                </p>
                <ul aria-label="Rows not imported" className="max-h-56 space-y-1 overflow-y-auto rounded-lg border p-2">
                  {review.skipped.slice(0, 200).map(({ row, reason }) => (
                    <li key={row.row}>
                      <span className="font-medium">
                        Line {row.row}: {row.label}
                      </span>
                      <span className="text-muted-foreground block">{reason}</span>
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="min-h-10" onClick={download}>
                  Download the list
                </Button>
              </div>
            )}
          </section>
        )}
        {message && <p role="alert">{message}</p>}
      </div>
      {review && review.copies.length > 0 && (
        <OverlayFooter className="p-4">
          <Button className="min-h-11 w-full" disabled={busy} onClick={() => void addCards()}>
            {busy ? 'Adding cards…' : `Add ${plural(review.copies.length, 'card')}`}
          </Button>
        </OverlayFooter>
      )}
    </OverlayDialog>
  );
}
