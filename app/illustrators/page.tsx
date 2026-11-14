import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicCataloguePage } from '@/components/public-catalogue-page';
import { PublicListFilter } from '@/components/public-list-filter';
import { getPublicIllustrators } from '@/lib/server/public-illustrators';
import { socialMetadata } from '@/lib/social-metadata';

const title = 'Pokémon card illustrators A to Z';
const description =
  'Every artist credited on an English Pokémon TCG card, A to Z, with how many cards they illustrated. Open an illustrator to see all of their cards, set by set.';
const url = 'https://holofolder.com/app/illustrators';
const BLOG_POST = 'https://holofolder.com/blog/build-an-illustrator-collection';

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { ...socialMetadata.openGraph, title, description, url },
  twitter: { ...socialMetadata.twitter, title, description },
};

/** "Atsuko Nishida" → "A", '"Big Mama" Tagawa' → "B", "5ban Graphics" → "#". */
const letterOf = (name: string) => {
  const letter = name
    .normalize('NFKD')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(letter) ? letter : '#';
};

export default async function IllustratorsIndexPage() {
  const illustrators = await getPublicIllustrators();
  const letters = new Map(
    [...Map.groupBy(illustrators, (illustrator) => letterOf(illustrator.name))].toSorted(([a], [b]) =>
      a === '#' ? 1 : b === '#' ? -1 : a.localeCompare(b),
    ),
  );
  return (
    <PublicCataloguePage>
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-muted-foreground text-sm">
          {description} New to collecting by artist?{' '}
          <a href={BLOG_POST} className="text-primary underline-offset-2 hover:underline">
            How to build an illustrator collection
          </a>
          .
        </p>
      </header>
      <div className="space-y-3">
        <PublicListFilter listId="illustrator-list" label="Find an illustrator" placeholder="Find an illustrator" />
        <nav aria-label="Letters" className="flex flex-wrap gap-1.5">
          {[...letters.keys()].map((letter) => (
            <a
              key={letter}
              href={`#letter-${letter === '#' ? 'other' : letter}`}
              className="border-border/60 text-muted-foreground hover:text-foreground inline-flex size-9 items-center justify-center rounded-full border text-xs font-semibold transition-colors"
            >
              {letter}
            </a>
          ))}
        </nav>
      </div>
      <div id="illustrator-list" className="space-y-8">
        {[...letters].map(([letter, group]) => (
          <section
            key={letter}
            id={`letter-${letter === '#' ? 'other' : letter}`}
            data-filter-group
            className="scroll-mt-4 space-y-3"
            aria-label={letter === '#' ? 'Other' : letter}
          >
            <h2 className="text-xl font-semibold">{letter}</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {group.map((illustrator) => (
                <li key={illustrator.slug} data-filter={illustrator.names.join(' ')}>
                  <Link
                    href={`/illustrators/${illustrator.slug}`}
                    className="holo-tile hover:border-primary/45 flex min-h-11 flex-col justify-center rounded-xl px-3 py-2 transition-colors"
                  >
                    <span className="truncate text-sm font-medium">{illustrator.name}</span>
                    {illustrator.cardCount !== undefined && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        {illustrator.cardCount} {illustrator.cardCount === 1 ? 'card' : 'cards'}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </PublicCataloguePage>
  );
}
