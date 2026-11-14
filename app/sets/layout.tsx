import type { ReactNode } from 'react';
import type { Metadata } from 'next';

// Public set checklists are the one part of the app meant for search, like the developer docs.
export const metadata: Metadata = {
  robots: { index: true, follow: true },
};

export default function SetsLayout({ children }: { children: ReactNode }) {
  return children;
}
