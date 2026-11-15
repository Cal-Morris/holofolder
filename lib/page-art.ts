// Michi method page art: one picture laid behind a rectangle of pockets (up to a whole page), with cards on top.
// Each artwork is anchored to its top-left pocket's slot id, so it travels with that pocket when pages move, pages
// are inserted, a move is undone or an offline layout edit replays, with no extra write.
import { isBinderUploadId } from '@/lib/binder-appearance';
import { normalizeArtworkFrame, type ArtworkFrame } from '@/lib/binder-design';
import { PUBLIC_CARD_IMAGE_BASE, toCardImageSrc } from '@/lib/card-image-url';
import { getOfficialArtworkUrl } from '@/lib/pokemon-artwork';

export type PageArtSource =
  | { kind: 'card'; cardId: string; image: string }
  | { kind: 'pokemon'; pokemonId: number }
  | { kind: 'upload'; id: string };

export interface PageArt {
  id: string;
  /** The slot id of the artwork's top-left pocket. */
  anchorSlotId: string;
  rows: number;
  cols: number;
  source: PageArtSource;
  frame: ArtworkFrame;
}

export const MAX_PAGE_ART = 200;
/** Grids go up to 8 × 8 (`set_binder_layout`). */
const MAX_SPAN = 8;
const ID = /^[a-z0-9-]{1,40}$/i;

const object = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const span = (v: unknown) =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_SPAN ? (v as number) : null;

/** A card image as its key on our asset host, or null for anything that isn't one of our card images. */
export function pageArtCardImageKey(value: unknown): string | null {
  const src = toCardImageSrc(
    typeof value === 'string' && !value.includes('://') ? PUBLIC_CARD_IMAGE_BASE + value : value,
  );
  return src?.startsWith(PUBLIC_CARD_IMAGE_BASE) ? src.slice(PUBLIC_CARD_IMAGE_BASE.length) : null;
}

function normalizeSource(value: unknown): PageArtSource | null {
  const v = object(value);
  if (!v) return null;
  if (v.kind === 'card') {
    const image = pageArtCardImageKey(v.image);
    return typeof v.cardId === 'string' && v.cardId.length >= 1 && v.cardId.length <= 200 && image
      ? { kind: 'card', cardId: v.cardId, image }
      : null;
  }
  if (v.kind === 'pokemon')
    return Number.isInteger(v.pokemonId) && (v.pokemonId as number) >= 1 && (v.pokemonId as number) <= 100_000
      ? { kind: 'pokemon', pokemonId: v.pokemonId as number }
      : null;
  if (v.kind === 'upload') return isBinderUploadId(v.id) ? { kind: 'upload', id: v.id.toLowerCase() } : null;
  return null;
}

function normalizeOne(value: unknown): PageArt | null {
  const v = object(value);
  if (!v) return null;
  const rows = span(v.rows),
    cols = span(v.cols),
    source = normalizeSource(v.source);
  if (
    typeof v.id !== 'string' ||
    !ID.test(v.id) ||
    typeof v.anchorSlotId !== 'string' ||
    v.anchorSlotId.length < 1 ||
    v.anchorSlotId.length > 200 ||
    !rows ||
    !cols ||
    !source
  )
    return null;
  return { id: v.id, anchorSlotId: v.anchorSlotId, rows, cols, source, frame: normalizeArtworkFrame(v.frame) };
}

/** Read path: a stored or cached value, keeping every valid artwork. Missing or broken means none. */
export function normalizePageArt(value: unknown): PageArt[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, MAX_PAGE_ART).flatMap((entry) => {
    const art = normalizeOne(entry);
    if (!art || seen.has(art.id)) return [];
    seen.add(art.id);
    return [art];
  });
}

/** Write path: the whole list or nothing, so a bad entry is a 400 instead of silently disappearing. */
export function parsePageArtInput(value: unknown): PageArt[] | null {
  if (!Array.isArray(value) || value.length > MAX_PAGE_ART) return null;
  const parsed = normalizePageArt(value);
  return parsed.length === value.length ? parsed : null;
}

/** Upload ids the list refers to. */
export function pageArtUploadIds(arts: readonly PageArt[]) {
  return [...new Set(arts.flatMap((art) => (art.source.kind === 'upload' ? [art.source.id] : [])))];
}

/** Image for catalogue sources; uploads are private and resolved by the caller (owner fetch or share route). */
export function pageArtCatalogSrc(source: PageArtSource): string | null {
  if (source.kind === 'card') return PUBLIC_CARD_IMAGE_BASE + source.image;
  if (source.kind === 'pokemon') return getOfficialArtworkUrl(source.pokemonId, 480);
  return null;
}

export interface PlacedPageArt {
  art: PageArt;
  /** Zero-based cell of the top-left pocket on the page. */
  row: number;
  col: number;
  /** Clipped to the page. */
  rows: number;
  cols: number;
}

/**
 * The artworks on one page, given its pocket ids in order (null for pockets without a slot). Spans are clipped to
 * the grid; `covered` holds the cell indexes under an artwork, which render as joined pockets.
 */
export function layoutPageArt(
  arts: readonly PageArt[],
  pageSlotIds: readonly (string | null | undefined)[],
  rows: number,
  cols: number,
) {
  const placed: PlacedPageArt[] = [];
  const covered = new Set<number>();
  if (!arts.length) return { placed, covered };
  const index = new Map<string, number>();
  pageSlotIds.forEach((id, i) => {
    if (id && i < rows * cols) index.set(id, i);
  });
  for (const art of arts) {
    const at = index.get(art.anchorSlotId);
    if (at === undefined) continue;
    const row = Math.floor(at / cols),
      col = at % cols;
    const item = { art, row, col, rows: Math.min(art.rows, rows - row), cols: Math.min(art.cols, cols - col) };
    placed.push(item);
    for (let r = row; r < row + item.rows; r++) for (let c = col; c < col + item.cols; c++) covered.add(r * cols + c);
  }
  return { placed, covered };
}

/** CSS that applies an artwork frame to an `<img>` filling its box, the same on screen and on paper. */
export function pageArtImageStyle(frame: ArtworkFrame) {
  const position = `${50 + frame.x * 50}% ${50 + frame.y * 50}%`;
  return {
    objectFit: frame.fit === 'fit' ? ('contain' as const) : ('cover' as const),
    objectPosition: position,
    transform: frame.zoom === 1 ? undefined : `scale(${frame.zoom})`,
    transformOrigin: position,
  };
}

/** A pocket's slice of an artwork on paper, all in millimetres. */
export interface PageArtSlice {
  art: PageArt;
  page: number;
  /** The pocket's cell on its page. */
  row: number;
  col: number;
  /** The whole picture's size, gaps included, and where this pocket's 63 × 88 mm window sits in it. */
  width: number;
  height: number;
  left: number;
  top: number;
}

/**
 * Slices for printing. The picture is laid across the real span, pocket windows plus the gap between them (the
 * pocket edges and the weld, measured card edge to card edge), and each pocket prints only its own window. Once
 * the slices are in the binder, the gaps hide exactly the strips that were skipped, so the picture runs straight on.
 */
export function pageArtSlices(
  pages: ReadonlyArray<{ page: number; placed: readonly PlacedPageArt[]; filled?: ReadonlySet<number> }>,
  cols: number,
  gap: { x: number; y: number },
  card: { width: number; height: number },
): PageArtSlice[] {
  const gx = Math.max(0, gap.x),
    gy = Math.max(0, gap.y);
  return pages.flatMap(({ page, placed, filled }) =>
    placed.flatMap((item) => {
      const width = item.cols * card.width + (item.cols - 1) * gx;
      const height = item.rows * card.height + (item.rows - 1) * gy;
      const slices: PageArtSlice[] = [];
      for (let r = 0; r < item.rows; r++)
        for (let c = 0; c < item.cols; c++) {
          if (filled?.has((item.row + r) * cols + item.col + c)) continue;
          slices.push({
            art: item.art,
            page,
            row: item.row + r,
            col: item.col + c,
            width,
            height,
            left: c * (card.width + gx),
            top: r * (card.height + gy),
          });
        }
      return slices;
    }),
  );
}

export interface PageArtRect {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

/** The rectangle of cells between two corner cells (indexes on the page), in either order. */
export function rectFromCorners(a: number, b: number, cols: number): PageArtRect {
  const [ar, ac, br, bc] = [Math.floor(a / cols), a % cols, Math.floor(b / cols), b % cols];
  return {
    row: Math.min(ar, br),
    col: Math.min(ac, bc),
    rows: Math.abs(ar - br) + 1,
    cols: Math.abs(ac - bc) + 1,
  };
}

const overlaps = (a: PageArtRect, b: PageArtRect) =>
  a.row < b.row + b.rows && b.row < a.row + a.rows && a.col < b.col + b.cols && b.col < a.col + a.cols;

/**
 * Put an artwork over a rectangle of one page: anchored to the pocket at its top-left corner, replacing the
 * artwork with the same id and any other on this page it would overlap. Null when that corner has no pocket.
 */
export function putPageArt(
  arts: readonly PageArt[],
  pageSlotIds: readonly (string | null | undefined)[],
  grid: { rows: number; cols: number },
  art: Pick<PageArt, 'id' | 'source' | 'frame'>,
  rect: PageArtRect,
) {
  const anchorSlotId = pageSlotIds[rect.row * grid.cols + rect.col];
  if (!anchorSlotId) return null;
  const covered = new Set(
    layoutPageArt(arts, pageSlotIds, grid.rows, grid.cols).placed.flatMap((placed) =>
      placed.art.id !== art.id && overlaps(placed, rect) ? [placed.art.id] : [],
    ),
  );
  const next: PageArt = { ...art, anchorSlotId, rows: rect.rows, cols: rect.cols };
  return {
    arts: [...arts.filter((a) => a.id !== art.id && !covered.has(a.id)), next],
    replaced: covered.size,
  };
}

/** A new artwork id. */
export function newPageArtId() {
  return crypto.randomUUID().slice(0, 13);
}
