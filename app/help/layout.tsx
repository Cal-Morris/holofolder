import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import Image from 'next/image';
import { ArrowUpRight } from 'lucide-react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsProvider } from '@/components/docs/provider';
import { helpSource } from '@/lib/help-source';
import '../docs/docs.css';

export const metadata: Metadata = {
  title: { template: '%s · Holo Folder Help', default: 'Holo Folder Help' },
  robots: { index: true, follow: true },
};

const HELP_SEARCH = {
  api: '/app/api/help-search',
  links: [
    ['Make your first binder', '/help/getting-started'],
    ['Add cards', '/help/adding-cards'],
    ['Scan a card', '/help/scanning'],
  ] as [string, string][],
};

export default function HelpLayout({ children }: { children: ReactNode }) {
  return (
    <div className="holo-docs" data-help="">
      <DocsProvider search={HELP_SEARCH}>
        <DocsLayout
          tree={helpSource.pageTree}
          tabs={false}
          containerProps={{
            style: {
              '--fd-docs-row-1': 'calc(env(safe-area-inset-top, 0px) + var(--fd-banner-height, 0px))',
            } as CSSProperties,
          }}
          themeSwitch={{ enabled: false }}
          nav={{
            title: (
              <span className="docs-brand">
                <Image
                  className="docs-brand-icon"
                  src="/app/holofolder-mark.png"
                  alt=""
                  width={32}
                  height={32}
                  unoptimized
                />
                <span>
                  Holo Folder <span className="docs-brand-label">Help</span>
                </span>
              </span>
            ),
            url: '/help',
          }}
          links={[
            { text: 'Developers', url: '/docs' },
            { type: 'button', text: 'Open app', url: '/app', external: true, icon: <ArrowUpRight size={14} /> },
          ]}
          sidebar={{
            collapsible: false,
            defaultOpenLevel: 1,
            footer: (
              <a className="docs-marketing-link" href="https://holofolder.com">
                Back to Holo Folder <ArrowUpRight size={13} />
              </a>
            ),
          }}
        >
          {children}
        </DocsLayout>
      </DocsProvider>
    </div>
  );
}
