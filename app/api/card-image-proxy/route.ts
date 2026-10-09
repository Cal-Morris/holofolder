import { after, NextRequest, NextResponse } from "next/server"
import { getDefaultCardImageMirror, parseTcgdexCardImageUrl } from "@/lib/card-image-blob"
import { IMMUTABLE_IMAGE_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

export function isAllowedImageHost(hostname: string) {
  return (
    hostname === "assets.tcgdex.net" ||
    hostname.endsWith(".tcgdex.net") ||
    hostname === "images.pokemontcg.io" ||
    hostname === "product-images.tcgplayer.com"
  )
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")

  if (!rawUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 })
  }

  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: "Invalid image URL" }, { status: 400 })
  }

  if (!["https:", "http:"].includes(url.protocol) || !isAllowedImageHost(url.hostname)) {
    return NextResponse.json({ error: "Image host is not allowed" }, { status: 400 })
  }

  // TCGdex card images are served from the Vercel Blob mirror; TCGdex is only hit when the copy is missing.
  const tcgdexImage = parseTcgdexCardImageUrl(url)
  const mirror = tcgdexImage ? getDefaultCardImageMirror() : null
  if (tcgdexImage && mirror) {
    try {
      const image = await mirror.loadImage(tcgdexImage)
      if (image.pendingUpload) {
        after(image.pendingUpload)
      }
      return new NextResponse(image.body, {
        headers: {
          "content-type": image.contentType,
          "x-content-type-options": "nosniff",
          "x-card-image-source": image.source,
          ...IMMUTABLE_IMAGE_CACHE_HEADERS,
        },
      })
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 502
      return NextResponse.json({ error: "Card image unavailable" }, { status: status === 404 ? 404 : 502 })
    }
  }

  const upstream = await fetch(url.toString(), {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
    next: { revalidate: 60 * 60 * 24 },
  })

  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream image fetch failed with ${upstream.status}` }, { status: upstream.status })
  }

  const contentType = upstream.headers.get("content-type") || "image/webp"
  const buffer = await upstream.arrayBuffer()

  return new NextResponse(buffer, {
    headers: {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      ...IMMUTABLE_IMAGE_CACHE_HEADERS,
    },
  })
}
