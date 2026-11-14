import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// The search page is meant for search engines; a page of results (?q=) marks itself noindex.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function SearchLayout({ children }: { children: ReactNode }) {
  return children;
}
