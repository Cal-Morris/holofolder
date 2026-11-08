'use client'
import type { ComponentProps, ReactNode } from 'react'
import { RootProvider } from 'fumadocs-ui/provider/next'
import { docsHref } from '@/lib/docs-routing'
export function DocsLink({ prefetch: _prefetch, onClick, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) {
  return <a {...props} onClick={event => {
    // Keep public /docs links on Framer, but support opening the Next origin directly.
    if (props.href) event.currentTarget.href = docsHref(props.href, window.location.pathname)
    onClick?.(event)
  }} />
}
export function DocsProvider({ children }: { children: ReactNode }) {
  return <RootProvider components={{ Link: DocsLink }} theme={{ enabled: false }} search={{ enabled: false }}>{children}</RootProvider>
}
