import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// Public card pages are meant for search, like the set checklists.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function CardsLayout({ children }: { children: ReactNode }) {
  return children;
}
