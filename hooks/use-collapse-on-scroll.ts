'use client';

import { useCallback, useState, type UIEvent } from 'react';
import { nextCollapsedState } from '@/lib/collapse-on-scroll';

/** Returns whether a view heading should be collapsed, plus an onScroll handler for its scroller. */
export function useCollapseOnScroll() {
  const [collapsed, setCollapsed] = useState(false);
  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const element = event.currentTarget;
    const range = element.scrollHeight - element.clientHeight;
    setCollapsed((current) => nextCollapsedState(current, element.scrollTop, range));
  }, []);
  const reset = useCallback(() => setCollapsed(false), []);
  return { collapsed, onScroll, reset };
}
