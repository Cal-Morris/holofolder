import { TRADING_CARD_ASPECT_RATIO } from '@/lib/page-scan';

export interface BinderFitInput {
  stage: { width: number; height: number };
  rows: number;
  cols: number;
  pages: 1 | 2;
  /** Page padding: 8px on phones, 16px from 640px. */
  padding: number;
  /** Gutter between the two pages of a spread. */
  spreadGap: number;
}

// Room for the active page's 2px outline inside the clipped stage.
const OUTLINE_CLEARANCE = 4;
const POCKET_GAP = 6;
// The page label sits in a 24px bottom gutter (pb-6 in binder-grid-page.tsx) instead of the bottom padding.
const PAGE_LABEL_GUTTER = 24;

/** The largest binder page (or spread) of whole pockets that fits the stage, or null when nothing fits. */
export function fitBinderPages({ stage, rows, cols, pages, padding, spreadGap }: BinderFitInput) {
  const gap = pages === 2 ? spreadGap : 0;
  const horizontalChrome = padding * 2 + POCKET_GAP * (cols - 1);
  const verticalChrome = padding + PAGE_LABEL_GUTTER + POCKET_GAP * (rows - 1);
  const pocketHeight = Math.min(
    (stage.height - OUTLINE_CLEARANCE - verticalChrome) / rows,
    ((stage.width - OUTLINE_CLEARANCE - gap) / pages - horizontalChrome) / cols / TRADING_CARD_ASPECT_RATIO,
  );
  if (pocketHeight <= 0) return null;

  return {
    pocketHeight,
    width: pages * (pocketHeight * TRADING_CARD_ASPECT_RATIO * cols + horizontalChrome) + gap,
    height: pocketHeight * rows + verticalChrome,
  };
}

// A spread may shrink pockets a little against one page, not much: wide binders (2×6) would otherwise turn
// into two short strips with tiny cards.
const SPREAD_MIN_POCKET_SCALE = 0.85;

/** Whether a two-page spread keeps pockets close to their single-page size. */
export function spreadKeepsPocketSize(input: Omit<BinderFitInput, 'pages'>) {
  const single = fitBinderPages({ ...input, pages: 1 });
  const spread = fitBinderPages({ ...input, pages: 2 });
  return Boolean(single && spread && spread.pocketHeight >= single.pocketHeight * SPREAD_MIN_POCKET_SCALE);
}

// The inside cover's title, ring and stats need a portrait-ish page with real height, or they clip.
const COVER_MIN_HEIGHT = 380;
const COVER_MAX_ASPECT = 1.2;

/** Whether one page of the fitted spread has clear room for the inside cover. */
export function insideCoverFits(spread: { width: number; height: number }, spreadGap: number) {
  const pageWidth = (spread.width - spreadGap) / 2;
  return spread.height >= COVER_MIN_HEIGHT && pageWidth <= spread.height * COVER_MAX_ASPECT;
}
