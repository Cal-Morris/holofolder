import { TRADING_CARD_CORNER_RADIUS } from '@/components/binder/pokemon-slot';
import { pageArtImageStyle, type PageArtSource, type PlacedPageArt } from '@/lib/page-art';

/**
 * Michi method artworks for one page, as items of the page's pocket grid. Absolutely positioned grid items take
 * their grid area as the containing block, so each picture covers its pockets and the gaps between them exactly,
 * at every size, without measuring. They come first, so the pockets (positioned, later in order) sit on top.
 */
export function PageArtLayer({
  placed,
  imageFor,
}: {
  placed: readonly PlacedPageArt[];
  imageFor: (source: PageArtSource) => string | null | undefined;
}) {
  return placed.map(({ art, row, col, rows, cols }) => {
    const src = imageFor(art.source);
    return (
      <div
        key={art.id}
        aria-hidden
        data-page-art={art.id}
        className="pointer-events-none absolute inset-0 overflow-hidden bg-black/10"
        style={{
          gridRow: `${row + 1} / span ${rows}`,
          gridColumn: `${col + 1} / span ${cols}`,
          borderRadius: TRADING_CARD_CORNER_RADIUS,
        }}
      >
        {src && (
          // oxlint-disable-next-line nextjs/no-img-element -- one picture across several pockets, framed with CSS; next/image would resize it per pocket
          <img src={src} alt="" draggable={false} className="h-full w-full" style={pageArtImageStyle(art.frame)} />
        )}
      </div>
    );
  });
}
