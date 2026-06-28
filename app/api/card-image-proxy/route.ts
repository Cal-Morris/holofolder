import { NextRequest, NextResponse } from "next/server"
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
