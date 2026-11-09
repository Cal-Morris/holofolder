import { after, NextRequest, NextResponse } from "next/server"
import { parseTcgdexCardImageUrl, type LoadedCardImage } from "@/lib/card-image-blob"
import { getCardImageSourceForHost, isCardImageSourceUrl, parseSourceCardImageUrl } from "@/lib/card-image-sources"
import { getCardImageStoreKind, getDefaultCardImageMirror } from "@/lib/card-image-store"
import { IMMUTABLE_IMAGE_CACHE_HEADERS } from "@/lib/http-cache"

export const instant = false

// Select a literal origin so a request parameter can only supply the image path and query.
function getImageOrigin(hostname: string) {
  switch (hostname) {
    case "assets.tcgdex.net": return "https://assets.tcgdex.net"
    case "product-images.tcgplayer.com": return "https://product-images.tcgplayer.com"
    case "images.pokemontcg.io": return "https://images.pokemontcg.io"
    case "images.scrydex.com": return "https://images.scrydex.com"
    case "limitlesstcg.nyc3.cdn.digitaloceanspaces.com": return "https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com"
    case "cdn.shopify.com": return "https://cdn.shopify.com"
    case "raw.githubusercontent.com": return "https://raw.githubusercontent.com"
    default: return null
  }
}

export function isAllowedImageHost(hostname: string) {
  return hostname !== "raw.githubusercontent.com" && getImageOrigin(hostname) !== null
}

// Pokémon artwork and sprites (PokeAPI on GitHub). Only this repository path: raw.githubusercontent.com serves anything.
const POKEAPI_SPRITES_PATH_PREFIX = "/PokeAPI/sprites/master/sprites/pokemon/"

export function isAllowedImageUrl(url: URL) {
  if (url.protocol !== "https:" || url.port || url.username || url.password) return false
  if (getCardImageSourceForHost(url.hostname)) return isCardImageSourceUrl(url)
  if (url.hostname === "assets.tcgdex.net") return true
  return (
    url.hostname === "raw.githubusercontent.com" &&
    url.pathname.startsWith(POKEAPI_SPRITES_PATH_PREFIX) &&
    !url.pathname.includes("..") &&
    /\.(?:png|svg|gif|webp)$/i.test(url.pathname)
  )
}

/** Widths the proxy will resize to (`&w=`). A fixed set keeps the CDN cache small. */
export const PROXY_IMAGE_WIDTHS = [96, 160, 240, 320, 480, 600] as const

export function parseProxyImageWidth(value: string | null): number | null {
  if (value === null) return null
  const width = Number(value)
  return (PROXY_IMAGE_WIDTHS as readonly number[]).includes(width) ? width : null
}

async function resizeImage(buffer: ArrayBuffer, width: number) {
  const { default: sharp } = await import("sharp")
  return sharp(Buffer.from(buffer))
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer()
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

  if (!isAllowedImageUrl(url)) {
    return NextResponse.json({ error: "Image host is not allowed" }, { status: 400 })
  }

  const rawWidth = request.nextUrl.searchParams.get("w")
  const width = parseProxyImageWidth(rawWidth)
  if (rawWidth !== null && width === null) {
    return NextResponse.json({ error: `Unsupported width; use one of ${PROXY_IMAGE_WIDTHS.join(", ")}` }, { status: 400 })
  }

  // Card images (TCGdex and the fallback sources) are served from the mirror store (R2 or Vercel Blob); the origin is
  // only hit when the copy is missing, and that copy is then uploaded after responding.
  const tcgdexImage = parseTcgdexCardImageUrl(url)
  const sourceImage = tcgdexImage ? null : parseSourceCardImageUrl(url)
  const mirror = tcgdexImage || sourceImage ? getDefaultCardImageMirror() : null
  if (mirror && (tcgdexImage || sourceImage)) {
    let image: LoadedCardImage
    try {
      image = tcgdexImage ? await mirror.loadImage(tcgdexImage) : await mirror.loadSourceImage(sourceImage!)
    } catch (error) {
      const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 502
      return NextResponse.json({ error: "Card image unavailable" }, { status: status === 404 ? 404 : 502 })
    }
    if (image.pendingUpload) {
      after(image.pendingUpload)
    }
    // The store keeps the original scan; `&w=` serves a smaller WebP for thumbnails and phones (cached at the CDN).
    let mirroredBody: ArrayBuffer | Buffer = image.body
    let mirroredType = image.contentType
    if (width !== null && !image.contentType.includes("svg")) {
      try {
        mirroredBody = await resizeImage(image.body, width)
        mirroredType = "image/webp"
      } catch (error) {
        console.error("[card-image-proxy] resize failed, serving the original:", error)
      }
    }
    return new NextResponse(new Uint8Array(mirroredBody), {
      headers: {
        "content-type": mirroredType,
        "x-content-type-options": "nosniff",
        "x-card-image-source": image.source === "blob" ? getCardImageStoreKind() : image.source,
        ...IMMUTABLE_IMAGE_CACHE_HEADERS,
      },
    })
  }

  const origin = getImageOrigin(url.hostname)
  if (!origin) {
    return NextResponse.json({ error: "Image host is not allowed" }, { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(`${origin}${url.pathname}${url.search}`, {
      redirect: "error",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      },
      next: { revalidate: 60 * 60 * 24 },
    })
  } catch {
    return NextResponse.json({ error: "Upstream image unavailable" }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream image fetch failed with ${upstream.status}` }, { status: upstream.status })
  }

  let contentType = upstream.headers.get("content-type") || "image/webp"
  let body: ArrayBuffer | Buffer = await upstream.arrayBuffer()

  if (width !== null && !contentType.includes("svg")) {
    try {
      body = await resizeImage(body, width)
      contentType = "image/webp"
    } catch (error) {
      console.error("[card-image-proxy] resize failed, serving the original:", error)
    }
  }

  return new NextResponse(new Uint8Array(body), {
    headers: {
      "content-type": contentType,
      "x-content-type-options": "nosniff",
      "x-card-image-source": tcgdexImage ? "tcgdex" : "upstream",
      ...IMMUTABLE_IMAGE_CACHE_HEADERS,
    },
  })
}
