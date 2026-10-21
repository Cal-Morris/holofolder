import { TRIMMED_CARD_IMAGE_SOURCES, type CardImageSource } from "./card-image-sources"

/** Longest edge kept for mirrored fallback-source images (TCGdex `high` images are about 600 x 825). */
export const SOURCE_IMAGE_MAX_WIDTH = 734
const SOURCE_IMAGE_WEBP_QUALITY = 85

/**
 * Stored form of a fallback-source card image: WebP, at most SOURCE_IMAGE_MAX_WIDTH wide (never enlarged).
 * A 900 KB Scrydex PNG becomes roughly 60-120 KB, which keeps the R2 mirror inside the free tier.
 */
export async function convertSourceImageToWebp(image: { body: ArrayBuffer; contentType: string; source?: CardImageSource }) {
  const { default: sharp } = await import("sharp")
  let pipeline = sharp(Buffer.from(image.body))
  // Retailer photos can sit on a white margin; keep only the card.
  if (image.source && TRIMMED_CARD_IMAGE_SOURCES.has(image.source)) pipeline = sharp(await pipeline.trim({ background: "#ffffff", threshold: 30 }).toBuffer())
  const output = await pipeline
    .resize({ width: SOURCE_IMAGE_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: SOURCE_IMAGE_WEBP_QUALITY })
    .toBuffer()
  const body = output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer
  return { body, contentType: "image/webp" }
}
