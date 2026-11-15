'use client';

import { useSyncExternalStore, type ComponentProps, type FC, type ReactNode } from 'react';
import Image from 'next/image';
import { useParams, usePathname } from 'next/navigation';
import { FrameworkProvider, type ImageProps } from 'fumadocs-core/framework';
import { RootProvider } from 'fumadocs-ui/provider/base';
import { docsHref } from '@/lib/docs-routing';

// MDX images arrive as static imports; next/image accepts them, as Fumadocs' own Next provider does.
const DocsImage = Image as unknown as FC<ImageProps>;
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

const DEVELOPER_SEARCH = {
  api: '/app/api/docs-search',
  links: [
    ['Connect an AI assistant', '/docs/mcp'],
    ['Create an API key', '/docs/api-keys'],
    ['Explore the API', '/docs/reference'],
  ] as [string, string][],
};

export function DocsProvider({
  children,
  search = DEVELOPER_SEARCH,
}: {
  children: ReactNode;
  search?: { api: string; links: [string, string][] };
}) {
  return (
    <FrameworkProvider
      Image={DocsImage}
      Link={DocsLink}
      usePathname={usePathname}
      useParams={useParams}
      useRouter={useDocsRouter}
    >
      <RootProvider theme={{ enabled: false }} search={{ options: { api: search.api }, links: search.links }}>
        {children}
      </RootProvider>
    </FrameworkProvider>
  );
}
