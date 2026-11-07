import { getCardImageAttributes } from "./card-image-loader"

/** Retain the actual decoded images, including in-flight prefetches promoted by a page turn. */
export class BinderSlotImages {
  private images = new Map<string, { image: HTMLImageElement; ready: Promise<void>; sizes: string }>()

  load(url: string, priority: "low" | "high" = "low", sizes = "25vw"): Promise<void> {
    const existing = this.images.get(url)
    if (existing && existing.sizes === sizes) {
      if (priority === "high") existing.image.fetchPriority = "high"
      return existing.ready
    }
    if (existing) {
      existing.image.removeAttribute("srcset")
      existing.image.removeAttribute("src")
    }
    const image = new Image()
    image.decoding = "async"
    image.fetchPriority = priority
    const attributes = getCardImageAttributes(url, sizes)
    image.sizes = attributes.sizes ?? ""
    if (attributes.srcSet) image.srcset = attributes.srcSet
    image.src = attributes.src
    const ready = image.decode().catch(() => {
      // The slot owns the error/artwork fallback. Allow later prefetches to retry.
      if (this.images.get(url)?.image === image) this.images.delete(url)
    })
    this.images.set(url, { image, ready, sizes })
    return ready
  }

  retain(urls: Set<string>) {
    for (const [url, entry] of this.images) {
      if (!urls.has(url)) {
        entry.image.removeAttribute("srcset")
        entry.image.removeAttribute("src")
        this.images.delete(url)
      }
    }
  }
}
