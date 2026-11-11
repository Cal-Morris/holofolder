import type { CSSProperties, ReactNode } from 'react';
import { BINDER_GRID_COOKIE } from '@/lib/binders/model';

// The binder while it starts: the app's real frame (header, binder toolbar row, dock) with the page of
// pockets still empty, so opening fills the page in place and nothing moves. The frame's classes mirror
// components/binder/app-header.tsx, the toolbar row in binder-app.tsx and bottom-nav.tsx; the page is fitted
// with the same sums as binderFitSize, in CSS (`.binder-skeleton-*` in globals.css). Server-safe (no hooks)
// so it can be in the prerendered shell of `/` and `/app-shell`. Nothing here is interactive or announced.
//
// Keep this markup small. React only paints a boundary's content with the static shell while the shell plus
// that content stays under 12.8 kB; past that the content is held back behind app/loading.tsx until a script
// runs (and never without one). So the icons are the header's shapes written out bare, with their stroke
// set once in CSS (`.binder-skeleton-icon`), not ten full lucide elements. The same goes for an eager
// <img>, which holds its boundary until the image loads. e2e/binder-start.e2e.ts checks it with scripts off.
const icon = (className: string, shape: ReactNode) => (
  <svg viewBox="0 0 24 24" className={`binder-skeleton-icon ${className}`}>
    {shape}
  </svg>
);
const search = (
  <>
    <path d="m21 21-4.34-4.34" />
    <circle cx="11" cy="11" r="8" />
  </>
);
const binder = (
  <>
    <rect width="18" height="18" x="3" y="3" rx="2" />
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </>
);
const inventory = <path d="M13 5h8M13 12h8M13 19h8m-18-2 2 2 4-4M3 7l2 2 4-4" />;
const wanted = (
  <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
);
const browse = (
  <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
);
const destinations: [string, ReactNode][] = [
  ['Binder', binder],
  ['Inventory', inventory],
  ['Wanted', wanted],
  ['Browse', browse],
];

// The prerendered shell can't read cookies, so this resizes its pockets to the last binder's grid (the cookie
// BinderApp writes) before the first paint. Only for the server-rendered fallback in app/page.tsx: React never
// hydrates a pending boundary's fallback, and a script rendered on the client doesn't run.
const START_GRID_SCRIPT = `(function(s){var m=/(?:^|; )${BINDER_GRID_COOKIE}=([1-8])x([1-8])(?:;|$)/.exec(document.cookie);if(!m)return;var r=+m[1],c=+m[2],n=r*c,sp=s.parentNode.querySelector("[data-skeleton=spread]");sp.style.setProperty("--r",r);sp.style.setProperty("--c",c);for(var i=0;i<sp.children.length;i++){var p=sp.children[i],t=p.firstElementChild;p.style.gridTemplateColumns="repeat("+c+",minmax(0,1fr))";p.style.gridTemplateRows="repeat("+r+",minmax(0,1fr))";while(p.children.length>n)p.lastElementChild.remove();while(p.children.length<n)p.appendChild(t.cloneNode())}})(document.currentScript)`;

export function BinderSkeleton({
  rows = 3,
  cols = 3,
  startGridFromCookie = false,
}: {
  rows?: number;
  cols?: number;
  startGridFromCookie?: boolean;
}) {
  const page = (second: boolean) => (
    <div
      className={`${second ? 'hidden xl:grid' : 'grid'} border-border/60 bg-card h-full w-full gap-1.5 rounded-2xl border p-2 pb-6 sm:p-4 sm:pb-6`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: rows * cols }, (_, index) => (
        <div key={index} data-skeleton="pocket" className="bg-muted/70 rounded-md" />
      ))}
    </div>
  );
  return (
    <main
      className="bg-background flex h-dvh max-h-dvh w-full flex-col overflow-hidden"
      aria-busy="true"
      data-testid="binder-skeleton"
    >
      <span className="sr-only">Opening your binder…</span>
      <div aria-hidden="true" className="border-border/40 mb-1 shrink-0 border-b pt-[var(--top-inset)]">
        <div className="pr-[var(--right-inset)] pl-[var(--left-inset)] sm:px-4">
          <div className="flex flex-wrap items-center gap-0 py-1 md:gap-2 md:px-3">
            <div className="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 px-1.5 xl:flex-none">
              {/* Lazy on purpose: React holds a boundary with an eager image back until the image loads, which
                  would put the whole skeleton behind app/loading.tsx. In view, it still loads straight away. */}
              {/* eslint-disable-next-line @next/next/no-img-element -- the static shell paints before any script */}
              <img
                src="/app/holofolder-mark.png"
                alt=""
                width={20}
                height={20}
                loading="lazy"
                className="h-5 w-5 shrink-0"
              />
              <span className="truncate text-sm font-semibold">Holo Folder</span>
            </div>
            <div className="border-border/40 order-last hidden w-full items-center gap-1 border-t pt-1 md:flex xl:order-none xl:w-auto xl:flex-1 xl:border-0 xl:pt-0">
              {[...destinations, ['Search', search] as const].map(([label, shape], index) => (
                <span
                  key={label}
                  className={`flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium ${index === 0 ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                >
                  {icon('h-3.5 w-3.5', shape)}
                  {label}
                </span>
              ))}
            </div>
            <div className="flex h-11 shrink-0 items-center px-3">
              <span className="bg-muted h-4 w-20 rounded" />
            </div>
            <div className="text-muted-foreground flex h-11 w-11 shrink-0 items-center justify-center">
              {icon('h-4 w-4', <path d="M5 12h.01M12 12h.01M19 12h.01" />)}
            </div>
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="flex shrink-0 items-center gap-1 px-3 pb-1 sm:px-4 md:px-7">
        <span className="border-border/60 bg-muted/40 h-9 w-32 rounded-full border" />
        <span className="border-border/60 bg-muted/40 h-9 w-20 rounded-full border" />
      </div>
      <div
        aria-hidden="true"
        className="min-h-0 flex-1 px-2 pb-[calc(var(--dock-clearance)+1rem)] sm:px-4 md:pb-[2.85rem]"
      >
        <div data-skeleton="stage" className="binder-skeleton-stage flex h-full w-full items-center justify-center">
          <div
            data-skeleton="spread"
            className="binder-skeleton-spread motion-safe:animate-pulse"
            style={{ '--r': rows, '--c': cols } as CSSProperties}
          >
            {page(false)}
            {page(true)}
          </div>
        </div>
      </div>
      <div
        aria-hidden="true"
        className="border-border/40 bg-background fixed inset-x-0 bottom-0 border-t pr-[var(--right-inset)] pb-[var(--dock-inset)] pl-[var(--left-inset)] md:hidden"
      >
        <div className="mx-auto grid h-[calc(var(--dock-bar)-1px)] w-full max-w-xl grid-cols-5 items-center">
          {[['Search', search] as const, ...destinations].map(([label, shape]) => (
            <span
              key={label}
              className={`flex h-11 flex-col items-center justify-center gap-0.5 ${label === 'Binder' ? 'text-primary' : 'text-muted-foreground'}`}
            >
              {icon('h-4 w-4', shape)}
              <span className="text-[10px] font-medium">{label}</span>
            </span>
          ))}
        </div>
      </div>
      {startGridFromCookie && <script dangerouslySetInnerHTML={{ __html: START_GRID_SCRIPT }} />}
    </main>
  );
}
