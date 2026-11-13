import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The app's one loading placeholder (`.holo-loading*` in app/globals.css). `bar` is the quiet grey shimmer for
 * text, prices and pills; `card` is a card-shaped slot with the rotating holo edge, the only colour in a loading
 * state. Size it with className; bars are pill-shaped and cards rounded-md unless className says otherwise. It
 * renders a block span so it also fits inside text; pass `inline-block` there.
 * Hidden from assistive tech: pair it with an `sr-only` label (or a labelled `aria-busy` container) where needed.
 */
export function Skeleton({
  variant = 'bar',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: 'bar' | 'card' }) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={cn(
        'holo-loading block',
        variant === 'card' ? 'holo-loading-card rounded-md' : 'holo-loading-bar rounded-full',
        className,
      )}
    />
  );
}
