'use client';

import Image, { type ImageProps } from 'next/image';
import { useState } from 'react';
import { toCardImageSrc, toCardImageProxySrc, PUBLIC_CARD_IMAGE_BASE } from '@/lib/card-image-url';
import { cardImageLoader, isProxiedCardImage, getCardImageAttributes } from '@/lib/card-image-loader';

// Inline so the loading placeholder also works offline.
const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='8'%3E%3Crect width='6' height='8' fill='%239ca3af' fill-opacity='.2'/%3E%3C/svg%3E";

type CardImageProps = Omit<ImageProps, 'src' | 'loader' | 'placeholder' | 'blurDataURL'> & {
  src: string;
  sizes: string;
};

export default function CardImage({ src: source, alt, sizes, fill, unoptimized, onError, ...props }: CardImageProps) {
  const direct = toCardImageSrc(source) ?? source;
  const [failedAsset, setFailedAsset] = useState<string | null>(null);
  const src = failedAsset === direct ? (toCardImageProxySrc(source) ?? direct) : direct;
  const [failedVariant, setFailedVariant] = useState<string | null>(null);
  const resize = isProxiedCardImage(src) && !unoptimized && failedVariant !== src;
  const asset = src.startsWith(PUBLIC_CARD_IMAGE_BASE);
  const attributes = asset && failedVariant !== src && !unoptimized ? getCardImageAttributes(src, sizes) : null;
  return (
    <picture style={{ display: 'contents' }}>
      {attributes?.srcSet && <source srcSet={attributes.srcSet} sizes={sizes} />}
      <Image
        width={fill ? undefined : 600}
        height={fill ? undefined : 825}
        {...props}
        key={`${src}:${resize}:${failedVariant === src}`}
        src={src}
        alt={alt}
        sizes={sizes}
        fill={fill}
        loader={cardImageLoader}
        unoptimized={!resize}
        crossOrigin={src.startsWith(PUBLIC_CARD_IMAGE_BASE) ? 'anonymous' : undefined}
        placeholder="blur"
        blurDataURL={PLACEHOLDER}
        onError={(event) => {
          // Older offline caches may only contain the original, not this width variant.
          if (asset && attributes?.srcSet) setFailedVariant(src);
          else if (
            src === direct &&
            direct.startsWith(PUBLIC_CARD_IMAGE_BASE) &&
            toCardImageProxySrc(source) !== direct
          )
            setFailedAsset(direct);
          else if (resize) setFailedVariant(src);
          else onError?.(event);
        }}
      />
    </picture>
  );
}
