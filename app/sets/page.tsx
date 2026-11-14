import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicCataloguePage } from '@/components/public-catalogue-page';
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
    <PublicCataloguePage>
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </header>
      {groups.map((group) => (
        <section key={group.series} className="space-y-3" aria-labelledby={`series-${setSlug(group.series)}`}>
          <h2 id={`series-${setSlug(group.series)}`} className="text-xl font-semibold">
            {group.series}
          </h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4 xl:grid-cols-5">
            {group.sets.map((set) => (
              <li key={set.id}>
                <Link
                  href={`/sets/${set.slug}`}
                  className="holo-tile hover:border-primary/45 flex h-full flex-col gap-2 rounded-2xl p-3 transition-colors"
                >
                  <span className="flex h-14 items-center justify-center sm:h-16">
                    {set.logo || set.symbol ? (
                      // eslint-disable-next-line @next/next/no-img-element -- set logo from our CDN, no resizing needed
                      <img
                        src={set.logo ?? set.symbol}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className={`w-auto max-w-full object-contain ${set.logo ? 'max-h-full' : 'max-h-10'}`}
                      />
                    ) : (
                      <span className="bg-muted size-10 rounded-full" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{set.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {[formatReleaseDate(set.releaseDate), set.officialCardCount && `Set of ${set.officialCardCount}`]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </PublicCataloguePage>
  );
}
