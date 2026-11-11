export const PUBLIC_JSON_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=86400',
  'CDN-Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
};

export const IMMUTABLE_IMAGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=31536000, immutable',
  'CDN-Cache-Control': 'public, s-maxage=31536000, immutable',
  'Vercel-CDN-Cache-Control': 'public, s-maxage=31536000, immutable',
};
