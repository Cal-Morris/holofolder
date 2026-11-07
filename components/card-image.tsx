"use client"

import Image, { type ImageProps } from "next/image"
import { useState } from "react"
import { toCardImageSrc } from "@/lib/card-image-url"
import { cardImageLoader, isProxiedCardImage } from "@/lib/card-image-loader"

// Inline so the loading placeholder also works offline.
const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='8'%3E%3Crect width='6' height='8' fill='%239ca3af' fill-opacity='.2'/%3E%3C/svg%3E"

type CardImageProps = Omit<ImageProps, "src" | "loader" | "placeholder" | "blurDataURL"> & { src: string; sizes: string }

export default function CardImage({ src: source, alt, sizes, fill, unoptimized, onError, ...props }: CardImageProps) {
  const src = toCardImageSrc(source) ?? source
  const [failedVariant, setFailedVariant] = useState<string | null>(null)
  const resize = isProxiedCardImage(src) && !unoptimized && failedVariant !== src
  return (
    <Image
      width={fill ? undefined : 600}
      height={fill ? undefined : 825}
      {...props}
      key={`${src}:${resize}`}
      src={src}
      alt={alt}
      sizes={sizes}
      fill={fill}
      loader={cardImageLoader}
      unoptimized={!resize}
      placeholder="blur"
      blurDataURL={PLACEHOLDER}
      onError={event => {
        // Older offline caches may only contain the original, not this width variant.
        if (resize) setFailedVariant(src)
        else onError?.(event)
      }}
    />
  )
}
