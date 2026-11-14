import type { ComponentProps, ReactNode } from 'react';
import CardImage from '@/components/card-image';
import { cn } from '@/lib/utils';

/**
 * One card in a card grid (a Pokémon's cards, an illustrator's cards, the public catalogue pages), built as
 * `<CardGridTile><CardGridArt>…badges</CardGridArt><CardGridBody>…lines</CardGridBody></CardGridTile>`. With `onOpen`,
 * one button covers the whole tile so the exact card tapped is the one that opens; buttons of the caller's own sit
 * above it with `relative z-[2]`. `className` adds to the tile (a border colour replaces the default).
 */
export function CardGridTile({
  onOpen,
  openLabel,
  className,
  children,
  ...props
}: ComponentProps<'li'> & { onOpen?: () => void; openLabel?: string }) {
  return (
    <li
      {...props}
      className={cn(
        'bg-background/60 border-border/50 relative flex min-w-0 flex-col overflow-hidden rounded-2xl border',
        onOpen && 'focus-within:border-primary/60 hover:border-primary/45 transition-colors',
        className,
      )}
    >
      {onOpen ? (
        <button
          type="button"
          aria-label={openLabel}
          onClick={onOpen}
          className="focus-visible:ring-primary/70 absolute inset-0 z-[1] rounded-2xl focus-visible:ring-2 focus-visible:outline-none"
        />
      ) : null}
      {children}
    </li>
  );
}

/** The tile's card image (or a "No image" card), with `children` drawn over it. */
export function CardGridArt({
  image,
  alt,
  sizes,
  children,
}: {
  image?: string | null;
  alt: string;
  sizes: string;
  children?: ReactNode;
}) {
  return (
    <div className="trading-card bg-muted/40 relative w-full">
      {image ? (
        <CardImage sizes={sizes} src={image} alt={alt} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-[11px]">
          No image
        </div>
      )}
      {children}
    </div>
  );
}

/** Status pills stacked in the art's top-left corner (Owned, Wanted). */
export function CardGridBadges({ children }: { children: ReactNode }) {
  return <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">{children}</div>;
}

/** The lines under the art. */
export function CardGridBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex min-w-0 flex-1 flex-col gap-0.5 p-2', className)}>{children}</div>;
}
