import type { CSSProperties, ReactNode } from 'react'
import type { Metadata } from 'next'
import Image from 'next/image'
import { ArrowUpRight, Bot } from 'lucide-react'
import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import { DocsLink, DocsProvider } from '@/components/docs/provider'
import { docsSource } from '@/lib/docs-source'
import './docs.css'

export const metadata: Metadata = {
  title: { template: '%s · Holo Folder Developers', default: 'Holo Folder Developers' },
  robots: { index: true, follow: true },
}

export default async function DocumentationLayout({ children }: { children: ReactNode }) {
  const source = await docsSource
  return <div className="holo-docs"><DocsProvider>
    <DocsLayout tree={source.pageTree} tabs={false}
      containerProps={{ style: { '--fd-docs-row-1': 'calc(env(safe-area-inset-top, 0px) + var(--fd-banner-height, 0px))' } as CSSProperties }} themeSwitch={{ enabled: false }}
      nav={{ title: <span className="docs-brand"><Image className="docs-brand-icon" src="/app/holofolder-mark.png" alt="" width={32} height={32} unoptimized /><span>Holo Folder <span className="docs-brand-label">Developers</span></span></span>, url: '/docs' }}
      links={[
        { text: 'AI & agents', url: '/docs/mcp' },
        { text: 'API explorer', url: '/docs/reference' },
        { type: 'button', text: 'Open app', url: '/app', external: true, icon: <ArrowUpRight size={14} /> },
      ]}
      sidebar={{ collapsible: false, defaultOpenLevel: 1, banner: <DocsLink href="/docs/mcp" className="docs-agent-link"><Bot size={19} /><span><strong>Connect an AI assistant</strong><span>Your collection, in your tools</span></span><ArrowUpRight size={14} /></DocsLink>, footer: <a className="docs-marketing-link" href="https://holofolder.com">Back to Holo Folder <ArrowUpRight size={13} /></a> }}>
      {children}
    </DocsLayout>
  </DocsProvider></div>
}
