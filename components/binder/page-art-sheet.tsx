'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { OverlayCloseButton, OverlayDialog, OverlayFooter, OverlayHeader } from '@/components/ui/overlay-dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  FramingControls,
  PictureSource,
  PocketPicker,
  PrintOptions,
  type PageArtTab,
} from '@/components/binder/page-art-controls';
import { rememberPageArtUpload } from '@/hooks/use-page-art-uploads';
import { uploadBinderArtwork } from '@/lib/binder-appearance-sync';
import type { ArtworkFrame } from '@/lib/binder-design';
import { validateArtwork } from '@/lib/binder-design-storage';
import { bindersApi, type BinderWithCount } from '@/lib/binders/client';
import { CARD_MM } from '@/lib/print-placeholders';
import {
  layoutPageArt,
  newPageArtId,
  pageArtSlices,
  putPageArt,
  rectFromCorners,
  type PageArt,
  type PageArtRect,
  type PageArtSource,
} from '@/lib/page-art';

const FULL_FRAME: ArtworkFrame = { fit: 'fill', zoom: 1, x: 0, y: 0 };
interface Draft {
  /** The saved artwork being edited; null for a new one. */
  id: string | null;
  rect: PageArtRect;
  source: PageArtSource | null;
  frame: ArtworkFrame;
}

function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

/** The first area: the selected pockets' bounding box on this page, else the first saved picture, else the page. */
function firstDraft(
  selection: readonly string[],
  slotIds: readonly (string | null)[],
  arts: readonly PageArt[],
  rows: number,
  cols: number,
): Draft {
  const picked = selection.flatMap((id) => (slotIds.includes(id) ? [slotIds.indexOf(id)] : []));
  if (picked.length) {
    const r = picked.map((i) => Math.floor(i / cols)),
      c = picked.map((i) => i % cols);
    return {
      id: null,
      rect: rectFromCorners(Math.min(...r) * cols + Math.min(...c), Math.max(...r) * cols + Math.max(...c), cols),
      source: null,
      frame: FULL_FRAME,
    };
  }
  const first = layoutPageArt(arts, slotIds, rows, cols).placed[0];
  return first
    ? { id: first.art.id, rect: first, source: first.art.source, frame: first.art.frame }
    : { id: null, rect: { row: 0, col: 0, rows, cols }, source: null, frame: FULL_FRAME };
}

/**
 * Michi method page art for one page: pick pockets, choose a card, a Pokémon or your own image, frame it, and print
 * true-size slices that line up across the binder's pockets.
 */
export default function PageArtSheet({
  binderId,
  owner,
  page,
  rows,
  cols,
  pageSlots,
  pageArt,
  initialSelection,
  imageFor,
  onSaved,
  onClose,
}: {
  binderId: string;
  /** The collection owner, whose private store holds uploads. */
  owner: string;
  page: number;
  rows: number;
  cols: number;
  /** This page's pockets in order: slot id and whether a card is in it. */
  pageSlots: ReadonlyArray<{ id: string; filled: boolean } | null>;
  pageArt: readonly PageArt[];
  /** Pockets selected in layout editing. */
  initialSelection: readonly string[];
  imageFor: (source: PageArtSource) => string | null | undefined;
  onSaved: (binders: BinderWithCount[]) => void;
  onClose: () => void;
  // oxlint-disable-next-line react-doctor/prefer-useReducer -- independent editor state (saved list, draft, tab, save status, picked files); one reducer would not read better
}) {
  const slotIds = useMemo(() => pageSlots.map((slot) => slot?.id ?? null), [pageSlots]);
  const [arts, setArts] = useState<PageArt[]>(() => [...pageArt]);
  const [draft, setDraft] = useState<Draft>(() => firstDraft(initialSelection, slotIds, pageArt, rows, cols));
  const [tab, setTab] = useState<PageArtTab>(draft.source?.kind ?? 'card');
  // Saving, and the last problem to show: one state, as a save always clears the problem.
  const [status, setStatus] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const { busy, error } = status;
  const setError = (message: string | null) => setStatus((current) => ({ ...current, error: message }));
  // Images picked here: shown from the device straight away, sent to the private store on save.
  const [uploads, setUploads] = useState<Record<string, { file: File; url: string }>>({});
  const objectUrls = useRef<string[]>([]);
  const online = useOnline();
  useEffect(() => () => objectUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);
  const image = (source: PageArtSource) =>
    (source.kind === 'upload' ? uploads[source.id]?.url : null) ?? imageFor(source);

  const saved = layoutPageArt(arts, slotIds, rows, cols).placed;
  const others = saved.filter((placed) => placed.art.id !== draft.id);
  const preview = draft.source
    ? [
        ...others,
        {
          ...draft.rect,
          art: { id: draft.id ?? 'draft', anchorSlotId: '', ...draft.rect, source: draft.source, frame: draft.frame },
        },
      ]
    : others;
  const startNew = () => setDraft({ id: null, rect: { row: 0, col: 0, rows, cols }, source: null, frame: FULL_FRAME });
  const put = () =>
    draft.source
      ? putPageArt(
          arts,
          slotIds,
          { rows, cols },
          { id: draft.id ?? newPageArtId(), source: draft.source, frame: draft.frame },
          draft.rect,
        )
      : null;

  async function chooseFile(file: File | undefined) {
    if (!file) return;
    try {
      await validateArtwork(file);
      const id = `upload:${crypto.randomUUID()}`;
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      setUploads((current) => ({ ...current, [id]: { file, url } }));
      setDraft((current) => ({ ...current, source: { kind: 'upload', id }, frame: FULL_FRAME }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'This image could not be used.');
    }
  }

  async function save(next: PageArt[], message: string) {
    setStatus({ busy: true, error: null });
    try {
      const pending = next.flatMap(({ source }) =>
        source.kind === 'upload' && uploads[source.id] ? [{ id: source.id, file: uploads[source.id]!.file }] : [],
      );
      await Promise.all(
        pending.map(async ({ id, file }) => {
          await uploadBinderArtwork(owner, id, file);
          await rememberPageArtUpload(owner, id, file).catch(() => undefined);
        }),
      );
      const { binders } = await bindersApi.setPageArt(binderId, next);
      setArts(binders.find((binder) => binder.id === binderId)?.pageArt ?? next);
      onSaved(binders);
      toast(message);
      setStatus({ busy: false, error: null });
      return true;
    } catch (cause) {
      setStatus({ busy: false, error: cause instanceof Error ? cause.message : 'Page art could not be saved.' });
      return false;
    }
  }

  const onSave = async () => {
    const result = put();
    if (!result) {
      setError('Start the picture on a pocket. This corner of the page has none.');
      return;
    }
    const id = result.arts[result.arts.length - 1]!.id;
    const message = result.replaced ? `Page art saved, replacing ${result.replaced} overlapping` : 'Page art saved';
    if (await save(result.arts, message)) setDraft((current) => ({ ...current, id }));
  };
  const onRemove = async () => {
    if (
      draft.id &&
      (await save(
        arts.filter((art) => art.id !== draft.id),
        'Page art removed',
      ))
    )
      startNew();
  };
  /** This page's slices to print, or why there are none. */
  const printSlices = ({ gap, skipFilled }: { gap: number; skipFilled: boolean }) => {
    const list = put()?.arts ?? arts;
    const filled = new Set(pageSlots.flatMap((slot, index) => (slot?.filled ? [index] : [])));
    const slices = pageArtSlices(
      [{ page, placed: layoutPageArt(list, slotIds, rows, cols).placed, filled: skipFilled ? filled : undefined }],
      cols,
      { x: gap, y: gap },
      CARD_MM,
    );
    if (!slices.length)
      setError(skipFilled ? 'Every pocket under the art already holds a card.' : 'Add a picture to print first.');
    return slices;
  };

  const area = draft.rect.rows * draft.rect.cols;
  return (
    <OverlayDialog
      onClose={onClose}
      aria-label={`Page art for page ${page}`}
      className="flex flex-col pr-[env(safe-area-inset-right)] pb-[var(--safe-bottom)] pl-[env(safe-area-inset-left)]"
      swipe={!busy}
    >
      <OverlayHeader className="border-b-0 px-4 pt-4 pb-2">
        <h2 className="text-sm font-semibold">Page art · page {page}</h2>
        <OverlayCloseButton label="Close page art" onClick={onClose} className="-mr-2 h-11 w-11" />
      </OverlayHeader>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3">
        <p className="text-muted-foreground text-sm">
          Lay one picture behind several pockets, up to the whole page. Empty pockets show their part of it and your
          cards sit on top. Drag across pockets, or tap two corners.
        </p>
        <PocketPicker
          rows={rows}
          cols={cols}
          pageSlots={pageSlots}
          preview={preview}
          saved={saved}
          editingId={draft.id}
          rect={draft.rect}
          imageFor={image}
          onRect={(rect) => setDraft((current) => ({ ...current, rect }))}
          onEdit={(placed) => {
            setDraft({ id: placed.art.id, rect: placed, source: placed.art.source, frame: placed.art.frame });
            setTab(placed.art.source.kind);
          }}
        />
        <div className="flex min-h-9 flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {draft.rect.cols} × {draft.rect.rows} {area === 1 ? 'pocket' : 'pockets'}
            {draft.id ? ' · editing a saved picture' : ''}
          </span>
          {(draft.id || draft.source) && (
            <Button variant="ghost" size="sm" className="ml-auto h-9" onClick={startNew}>
              New picture
            </Button>
          )}
        </div>
        <PictureSource
          tab={tab}
          onTab={setTab}
          onPick={(source) => {
            setDraft((current) => ({ ...current, source, frame: FULL_FRAME }));
            setError(null);
          }}
          onFile={(file) => void chooseFile(file)}
          softPrint={Boolean(draft.source && draft.source.kind !== 'upload' && area > 3)}
        />
        {draft.source && (
          <FramingControls frame={draft.frame} onChange={(frame) => setDraft((current) => ({ ...current, frame }))} />
        )}
        <PrintOptions slices={printSlices} imageFor={image} />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {!online && (
          <p role="status" className="text-muted-foreground text-sm">
            You’re offline. Page art shows offline, but changes need a connection.
          </p>
        )}
      </div>

      <OverlayFooter className="px-4">
        {draft.id && (
          <Button variant="outline" className="h-11 rounded-2xl" disabled={busy || !online} onClick={onRemove}>
            Remove
          </Button>
        )}
        <Button className="h-11 flex-1 rounded-2xl" disabled={busy || !online || !draft.source} onClick={onSave}>
          {busy ? 'Saving…' : 'Save page art'}
        </Button>
      </OverlayFooter>
    </OverlayDialog>
  );
}
