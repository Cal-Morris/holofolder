import { appPath } from '@/lib/app-path';

export function docsCanonicalUrl(path: string) {
  return `https://holofolder.com${appPath(path)}`;
}

/** Docs and help only live under /app. Prefix their links on the server too, so crawlers don't hit Framer's 308. */
export function docsHref(href: string) {
  return /^\/(?:docs|help)(?:[/?#]|$)/.test(href) ? `/app${href}` : href;
}
