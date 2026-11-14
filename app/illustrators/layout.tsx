import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// Public illustrator pages are meant for search, like the set checklists.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function IllustratorsLayout({ children }: { children: ReactNode }) {
  return children;
}
