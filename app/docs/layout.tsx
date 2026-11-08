import type { ReactNode } from 'react'
import type { Metadata } from 'next'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsLink, DocsProvider } from '@/components/docs/provider'
import { docsSource } from '@/lib/docs-source'
import './docs.css'
export const metadata: Metadata = { title: { template: '%s · Holo Folder Docs', default: 'Holo Folder Docs' }, robots: { index: true, follow: true } }
export default function DocumentationLayout({ children }: { children: ReactNode }) {
  return <div className="holo-docs"><DocsProvider>
    <header className="docs-header"><DocsLink href="/docs" className="docs-brand">Holo Folder <span>Developers</span></DocsLink><a href="/app">Open app</a></header>
    <div className="docs-frame"><nav className="docs-navigation" aria-label="Documentation">{docsSource.getPages().map(page => <DocsLink key={page.url} href={page.url}>{page.data.title}</DocsLink>)}</nav>
      <DocsLayout tree={docsSource.pageTree} nav={{ enabled: false }} sidebar={{ enabled: false }} searchToggle={{ enabled: false }} themeSwitch={{ enabled: false }}>{children}</DocsLayout>
    </div>
  </DocsProvider></div>
}
