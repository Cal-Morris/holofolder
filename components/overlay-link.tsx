'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
// oxlint-disable-next-line react-doctor/no-flush-sync -- the close has to commit before the overlay's history traversal starts
import { flushSync } from 'react-dom';
import type { ComponentProps } from 'react';
import { runAfterOverlayHistory } from '@/hooks/use-overlay';

type OverlayLinkProps = Omit<ComponentProps<typeof Link>, 'href' | 'onNavigate'> & {
  href: string;
  onClose: () => void;
};

export function OverlayLink({ href, onClose, ...props }: OverlayLinkProps) {
  const router = useRouter();
  return (
    <Link
      {...props}
      href={href}
      prefetch={false}
      onNavigate={(event) => {
        event.preventDefault();
        // Commit the close before waiting for the overlay's back traversal.
        flushSync(onClose);
        runAfterOverlayHistory(() => router.push(href));
      }}
    />
  );
}
