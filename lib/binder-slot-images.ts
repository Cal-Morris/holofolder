/** Retain the actual decoded images, including in-flight prefetches promoted by a page turn. */
export class BinderSlotImages {
  private images = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>()

  load(url: string, priority: "low" | "high" = "low"): Promise<void> {
    const existing = this.images.get(url)
    if (existing) {
      if (priority === "high") existing.image.fetchPriority = "high"
      return existing.ready
    }
    const image = new Image()
    image.decoding = "async"
    image.fetchPriority = priority
    image.src = url
    const ready = image.decode().catch(() => {
      // The slot owns the error/artwork fallback. Allow later prefetches to retry.
      if (this.images.get(url)?.image === image) this.images.delete(url)
    })
    this.images.set(url, { image, ready })
    return ready
  }

  retain(urls: Set<string>) {
    for (const [url, entry] of this.images) {
      if (!urls.has(url)) {
        entry.image.removeAttribute("src")
        this.images.delete(url)
      }
    }
  }
}
