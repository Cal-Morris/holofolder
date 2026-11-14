import Link from 'next/link';
import type { ReactNode } from 'react';
import { CreditsNotice } from '@/components/credits';

const SECTIONS = [
  { href: '/sets', label: 'Sets' },
  { href: '/pokemon', label: 'Pokémon' },
  { href: '/illustrators', label: 'Illustrators' },
];

const NO_CRUMBS: { href: string; label: string }[] = [];
const crumbLink = 'inline-flex min-h-9 items-center underline-offset-2 hover:underline';

/**
 * The frame of every public catalogue page (sets, Pokémon, illustrators): breadcrumb, section links, a wide centred column and the
 * credits line. `jsonLd` is written into the page as structured data.
 */
export function PublicCataloguePage({
  crumbs = NO_CRUMBS,
  jsonLd,
  children,
}: {
  crumbs?: { href: string; label: string }[];
  jsonLd?: object;
  children: ReactNode;
}) {
  return (
    <main className="bg-background safe-area-top safe-area-bottom min-h-screen px-4 sm:px-6 lg:px-8">
      {jsonLd && (
        <script
          type="application/ld+json"
          // JSON.stringify output with "<" escaped cannot close the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      )}
      <div className="mx-auto max-w-6xl space-y-8 pt-4 pb-12 sm:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <nav aria-label="Breadcrumb" className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
            <Link href="/" className={`${crumbLink} text-foreground font-semibold`}>
              Holo Folder
            </Link>
            {crumbs.map((crumb) => (
              <span key={crumb.href} className="flex min-w-0 items-center gap-1.5">
                <span aria-hidden>/</span>
                <Link href={crumb.href} className={`${crumbLink} truncate`}>
                  {crumb.label}
                </Link>
              </span>
            ))}
          </nav>
          <nav aria-label="Catalogue" className="flex items-center gap-1 text-sm font-medium">
            {SECTIONS.map((section) => (
              <Link
                key={section.href}
                href={section.href}
                className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex min-h-9 items-center rounded-full px-3 transition-colors"
              >
                {section.label}
              </Link>
            ))}
          </nav>
        </div>
        {children}
        <CreditsNotice className="text-muted-foreground text-xs" />
      </div>
    </main>
  );
}

/** A labelled fact in a catalogue page header ("Released 8 November 2024"). */
export function CatalogueFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="holo-tile min-w-0 rounded-xl px-3 py-2">
      <dt className="text-muted-foreground truncate text-xs">{label}</dt>
      <dd className="truncate font-medium tabular-nums">{value}</dd>
    </div>
  );
}
