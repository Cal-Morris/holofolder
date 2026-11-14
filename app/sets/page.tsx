import type { Metadata } from 'next';
import Link from 'next/link';
import { CreditsNotice } from '@/components/credits';
import { getPublicSets } from '@/lib/server/public-sets';
import { groupSetsBySeries } from '@/lib/set-browse';
import { formatReleaseDate, setSlug } from '@/lib/set-pages';
import { socialMetadata } from '@/lib/social-metadata';

const title = 'Pokémon TCG set lists and checklists';
const description =
  'Every English Pokémon TCG set with its release date and printed card count, newest first. Open a set for its full card list, checklist and binder layout.';
const url = 'https://holofolder.com/app/sets';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { ...socialMetadata.openGraph, title, description, url },
  twitter: { ...socialMetadata.twitter, title, description },
};

export default async function SetsIndexPage() {
  const groups = groupSetsBySeries(await getPublicSets());
  return (
    <main className="bg-background safe-area-bottom min-h-screen px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-2">
          <Link
            href="/"
            className="text-muted-foreground inline-flex min-h-9 items-center text-sm underline-offset-2 hover:underline"
          >
            Holo Folder
          </Link>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-muted-foreground text-sm">{description}</p>
        </header>
        {groups.map((group) => (
          <section key={group.series} className="space-y-2" aria-labelledby={`series-${setSlug(group.series)}`}>
            <h2 id={`series-${setSlug(group.series)}`} className="text-lg font-semibold">
              {group.series}
            </h2>
            <ul className="space-y-1.5">
              {group.sets.map((set) => (
                <li key={set.id}>
                  <Link
                    href={`/sets/${set.slug}`}
                    className="holo-tile flex min-h-11 items-center justify-between gap-3 rounded-xl px-3 py-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{set.name}</span>
                      {set.releaseDate && (
                        <span className="text-muted-foreground block text-xs">
                          {formatReleaseDate(set.releaseDate)}
                        </span>
                      )}
                    </span>
                    {set.officialCardCount ? (
                      <span className="text-muted-foreground shrink-0 text-xs">Set of {set.officialCardCount}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <CreditsNotice className="text-muted-foreground text-xs" />
      </div>
    </main>
  );
}
