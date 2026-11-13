'use client';

import { useSyncExternalStore, type ComponentProps, type ReactNode } from 'react';
import { useParams, usePathname } from 'next/navigation';
import { FrameworkProvider } from 'fumadocs-core/framework';
import { RootProvider } from 'fumadocs-ui/provider/base';
import { docsHref } from '@/lib/docs-routing';

const subscribe = () => () => {};
const docsRouter = {
  push: (href: string) => {
    window.location.assign(docsHref(href, window.location.pathname));
  },
  refresh: () => {
    window.location.reload();
  },
};
const useDocsRouter = () => docsRouter;

export function DocsLink({ prefetch: _prefetch, href, ...props }: ComponentProps<'a'> & { prefetch?: boolean }) {
  const pathname = useSyncExternalStore(
    subscribe,
    () => window.location.pathname,
    () => '',
  );
  // oxlint-disable-next-line jsx-a11y/anchor-has-content -- the link's children arrive through the props spread
  return <a {...props} href={href ? docsHref(href, pathname) : href} />;
}

export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <FrameworkProvider Link={DocsLink} usePathname={usePathname} useParams={useParams} useRouter={useDocsRouter}>
      <RootProvider
        theme={{ enabled: false }}
        search={{
          options: { api: '/app/api/docs-search' },
          links: [
            ['Connect an AI assistant', '/docs/mcp'],
            ['Create an API key', '/docs/api-keys'],
            ['Explore the API', '/docs/reference'],
          ],
        }}
      >
        {children}
      </RootProvider>
    </FrameworkProvider>
  );
}
