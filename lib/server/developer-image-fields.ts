import { resolveDeveloperImage, type DeveloperImage } from '@/lib/server/developer-images'

// Provider payloads have several image shapes, including images.small and translated logos.
export async function sanitizeDeveloperImages(value: unknown, resolve: (source: string | null) => Promise<DeveloperImage> = resolveDeveloperImage, imageGroup = false): Promise<unknown> {
  if (Array.isArray(value)) {
    const output = []
    for (let n = 0; n < value.length; n += 8) output.push(...await Promise.all(value.slice(n, n + 8).map(item => sanitizeDeveloperImages(item, resolve, imageGroup))))
    return output
  }
  if (imageGroup && typeof value === 'string') return (await resolve(value)).url
  if (!value || typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    const image = imageGroup || /^(?:(?:card|small|large)?images?(?:url|small|large)?|thumbnails?(?:url)?|logos?|symbols?)$/i.test(key.replaceAll('_',''))
    if (image && (typeof child === 'string' || child === null)) {
      const resolved = await resolve(child)
      output[key] = resolved.url
      output[`${key}Availability`] = resolved.availability
    } else output[key] = await sanitizeDeveloperImages(child, resolve, image)
  }
  return output
}
