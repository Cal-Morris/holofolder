'use client';

import { Suspense, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { isAppNavigation, navigationProgressStarters } from '@/lib/navigation-progress';

const SHOW_AFTER_MS = 150;
const GIVE_UP_AFTER_MS = 15_000;

/** Holo top bar for slow page loads: link clicks and startNavigationProgress() start it, the route change ends it. */
export function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <ProgressBar />
    </Suspense>
  );
}

function ProgressBar() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const bar = useRef<HTMLDivElement>(null);
  const finish = useRef(() => {});

  useEffect(() => {
    let timers: number[] = [];
    let running = false;
    const clear = () => {
      for (const id of timers) window.clearTimeout(id);
      timers = [];
    };
    const done = () => {
      if (!running) return;
      running = false;
      clear();
      const el = bar.current;
      if (el?.dataset.state !== 'loading') return;
      el.dataset.state = 'done';
      timers.push(window.setTimeout(() => delete el.dataset.state, 500));
    };
    const start = () => {
      if (running) return;
      running = true;
      clear();
      if (bar.current) delete bar.current.dataset.state;
      timers.push(
        window.setTimeout(() => {
          if (bar.current) bar.current.dataset.state = 'loading';
        }, SHOW_AFTER_MS),
        window.setTimeout(done, GIVE_UP_AFTER_MS),
      );
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || link.hasAttribute('download')) return;
      if (link.target && link.target !== '_self') return;
      if (isAppNavigation(new URL(link.href), new URL(window.location.href))) start();
    };

    finish.current = done;
    navigationProgressStarters.add(start);
    document.addEventListener('click', onClick, true);
    return () => {
      clear();
      navigationProgressStarters.delete(start);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  useEffect(() => finish.current(), [pathname, search]);

  return <div ref={bar} aria-hidden className="holo-nav-progress" />;
}
