'use client';

import { toCardThumbnailSrc } from '@/lib/card-image-url';

/**
 * Small card image for plain lists (Quick mode, Show mode). Loads the stored small rendition and switches to the full
 * image once if the small one is missing, so a card never shows a broken thumbnail.
 */
export function CardThumbnail({ image, lazy = false }: { image?: string | null; lazy?: boolean }) {
  const thumb = toCardThumbnailSrc(image);
  if (!thumb) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- card thumbnails from the asset CDN, cached by the service worker
    <img
      src={thumb.src}
      alt=""
      loading={lazy ? 'lazy' : undefined}
      className="absolute inset-0 h-full w-full object-cover"
      onError={(event) => {
        if (event.currentTarget.src !== thumb.full) event.currentTarget.src = thumb.full;
      }}
    />
  );
}
