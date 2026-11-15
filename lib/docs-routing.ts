import { appPath } from '@/lib/app-path';

export function docsCanonicalUrl(path: string) {
  return `https://holofolder.com${appPath(path)}`;
}

export function docsHref(href: string, pathname: string) {
  return /^\/app\/(?:docs|help)(?:\/|$)/.test(pathname) && /^\/(?:docs|help)(?:[/?#]|$)/.test(href)
    ? `/app${href}`
    : href;
}
