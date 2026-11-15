import type { CollectionNavigationRead } from '@/lib/collection-navigation';
import type { nativeCardConsumers } from '@/lib/collection/native-card-consumers';
import { formatCardFinishLabel } from '@/lib/card-labels';
import { toCardImageSrc, toSmallCardAssetSrc } from '@/lib/card-image-url';

/** A standard Pokémon card, which slides into a standard penny sleeve (about 66 × 91 mm). */
export const CARD_MM = { width: 63, height: 88 } as const;
/** Nine per printed page, three by three, like a nine-pocket binder page. */
export const SHEET_COLS = 3;
export const SHEET_ROWS = 3;
export const PER_SHEET = SHEET_COLS * SHEET_ROWS;
export const CALIBRATION_MM = 50;

export type PaperSize = 'a4' | 'letter';
export type PlaceholderStyle = 'image' | 'ink';

export const PAPER: Record<PaperSize, { label: string; css: string; width: number; height: number }> = {
  a4: { label: 'A4', css: 'A4', width: 210, height: 297 },
  letter: { label: 'US Letter', css: 'letter', width: 215.9, height: 279.4 },
};

/** Where the 3 × 3 grid of cards starts on the page, centred, in mm. */
export function gridOrigin(paper: PaperSize) {
  const { width, height } = PAPER[paper];
  return {
    left: (width - SHEET_COLS * CARD_MM.width) / 2,
    top: (height - SHEET_ROWS * CARD_MM.height) / 2,
  };
}

/** US and Canadian locales print on Letter; everyone else on A4. */
export function defaultPaper(locale: string | undefined): PaperSize {
  return /-(US|CA)$/i.test(locale ?? '') ? 'letter' : 'a4';
}

/** One wanted card as the printout needs it. */
export interface PrintWant {
  key: string;
  binderId: string;
  binderName: string;
  /** Pocket index in the binder, or null when the pocket is gone. */
  slotIndex: number | null;
  /** Pockets per binder page, or null when the layout is unknown. */
  capacity: number | null;
  /** True for a 3 × 3 binder, where a printed page lines up with the binder page pocket for pocket. */
  nineGrid: boolean;
  wantedIndex: number;
  occupied: boolean;
  name: string;
  set: string | null;
  number: string | null;
  rarity: string | null;
  illustrator: string | null;
  finish: string | null;
  /** Our full-size image and its small rendition, in the order to try them. Empty prints the ink saver layout. */
  images: string[];
}

export type PrintSheet = (PrintWant | null)[];

export function wantPosition(want: Pick<PrintWant, 'slotIndex' | 'capacity'>) {
  if (want.slotIndex == null || !want.capacity) return null;
  return { page: Math.floor(want.slotIndex / want.capacity) + 1, pocket: (want.slotIndex % want.capacity) + 1 };
}

export function positionLabel(want: PrintWant) {
  const position = wantPosition(want);
  return position ? `Page ${position.page} · Pocket ${position.pocket}` : null;
}

/** Every native want with what the printout shows. Pure: reads the same model the Wanted tab lists. */
export function toPrintWants(
  model: NonNullable<ReturnType<typeof nativeCardConsumers>>,
  read: CollectionNavigationRead,
): PrintWant[] {
  const snapshot = read.evidence.kind === 'unavailable' ? null : read.evidence.snapshot;
  return model.wants.map((entry) => {
    const binder = snapshot?.binders.find((b) => b.collectionId === entry.destination.collectionId);
    const index = binder?.slots.findIndex((slot) => slot.id === entry.destination.slotId) ?? -1;
    const layout = read.layouts.find(
      (l) => l.collectionId === entry.destination.collectionId && l.layoutRevision === binder?.layoutRevision,
    );
    const { want, card } = entry;
    const localId = want.local_id ?? card?.localId ?? null;
    const total = want.set_total ?? card?.set.officialCardCount ?? null;
    const full = toCardImageSrc(card?.image ?? want.card_image);
    const small = full ? toSmallCardAssetSrc(full) : null;
    return {
      key: entry.key,
      binderId: entry.destination.collectionId,
      binderName: entry.collectionName,
      slotIndex: index < 0 ? null : index,
      capacity: layout ? layout.rows * layout.cols : null,
      nineGrid: layout?.rows === SHEET_ROWS && layout.cols === SHEET_COLS,
      wantedIndex: entry.destination.wantedIndex,
      occupied: entry.occupied,
      name: card?.name ?? want.card_name,
      set: card?.set.name ?? want.card_set ?? null,
      number: localId ? (total ? `${localId}/${total}` : localId) : null,
      rarity: want.rarity ?? card?.rarity ?? null,
      illustrator: want.illustrator ?? card?.illustrator ?? null,
      finish: want.card_finish ? formatCardFinishLabel(want.card_finish) : null,
      images: [full, small].filter((src, i, all): src is string => !!src && all.indexOf(src) === i),
    };
  });
}

/** The want list as shown, packed nine to a page. */
export function listSheets(wants: readonly PrintWant[]): PrintSheet[] {
  const sheets: PrintSheet[] = [];
  for (let i = 0; i < wants.length; i += PER_SHEET) sheets.push(wants.slice(i, i + PER_SHEET));
  return sheets;
}

/**
 * A binder's empty wanted pockets, one placeholder per pocket (its first want), in binder order. Pockets that already
 * hold a card are skipped. Binder pages are numbered from 1; a want whose position is unknown has no page.
 */
export function binderWants(wants: readonly PrintWant[], binderId: string): PrintWant[] {
  const bySlot = new Map<number, PrintWant>();
  for (const want of wants) {
    if (want.binderId !== binderId || want.occupied || want.slotIndex == null) continue;
    const current = bySlot.get(want.slotIndex);
    if (!current || want.wantedIndex < current.wantedIndex) bySlot.set(want.slotIndex, want);
  }
  return [...bySlot.values()].toSorted((a, b) => a.slotIndex! - b.slotIndex!);
}

/** The binder pages that have something to print, ascending. */
export function binderPages(wants: readonly PrintWant[], binderId: string): number[] {
  return [...new Set(binderWants(wants, binderId).flatMap((want) => wantPosition(want)?.page ?? []))];
}

/**
 * Printed pages for a binder's page range. Every binder page starts a new printed page, so a printout never mixes two
 * binder pages. On a 3 × 3 binder each placeholder sits in its own pocket's place (empty cells stay blank); other
 * layouts are packed in pocket order and run onto another sheet past nine. Unknown positions come last, packed.
 */
export function binderSheets(wants: readonly PrintWant[], binderId: string, from = 1, to = Infinity): PrintSheet[] {
  const pages = new Map<number, PrintWant[]>();
  const unplaced: PrintWant[] = [];
  for (const want of binderWants(wants, binderId)) {
    const position = wantPosition(want);
    if (!position) unplaced.push(want);
    else if (position.page >= from && position.page <= to)
      pages.set(position.page, [...(pages.get(position.page) ?? []), want]);
  }
  const sheets: PrintSheet[] = [];
  for (const page of [...pages.keys()].toSorted((a, b) => a - b)) {
    const group = pages.get(page)!;
    if (group[0].nineGrid) {
      const sheet: PrintSheet = Array.from({ length: PER_SHEET }, () => null);
      for (const want of group) sheet[wantPosition(want)!.pocket - 1] = want;
      sheets.push(sheet);
    } else sheets.push(...listSheets(group));
  }
  return [...sheets, ...listSheets(unplaced)];
}

export function placeholderCount(sheets: readonly PrintSheet[]) {
  return sheets.reduce((count, sheet) => count + sheet.filter(Boolean).length, 0);
}
