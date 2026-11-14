import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { PublicCardGrid } from '@/components/public-card-grid';
import { PublicCataloguePage } from '@/components/public-catalogue-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cleanSearchQuery, PUBLIC_SEARCH_LIMIT, searchPublicCards } from '@/lib/server/public-search';
import { socialMetadata } from '@/lib/social-metadata';

const title = 'Find your Pokémon card';
const description =
  'Search every English Pokémon TCG card in our catalogue by name, card number (like 161/131), set or illustrator, and see the card, its set and its artist.';
const url = 'https://holofolder.com/app/search';
const EXAMPLES = ['Umbreon VMAX', '161/131', 'Surging Sparks', 'Mitsuhiro Arita'];

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: url },
  openGraph: { ...socialMetadata.openGraph, title, description, url },
  twitter: { ...socialMetadata.twitter, title, description },
};

type SearchParams = Promise<{ q?: string | string[] }>;

const searchHref = (query: string) => `/search?q=${encodeURIComponent(query)}`;

export default function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <PublicCataloguePage>
      <header className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="text-muted-foreground text-sm">{description}</p>
      </header>
      <Suspense fallback={<SearchForm query="" />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </PublicCataloguePage>
  );
}

/** A plain GET form, so it works before the page's JavaScript loads and from holofolder.com. */
function SearchForm({ query }: { query: string }) {
  return (
    <form action="/app/search" method="get" role="search" className="flex gap-2">
      <div className="relative min-w-0 flex-1">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
        <Input
          type="search"
          name="q"
          aria-label="Card name, number, set or illustrator"
          defaultValue={query}
          placeholder="Name, number or set"
          maxLength={80}
          enterKeyHint="search"
          className="h-11 rounded-2xl pl-9"
        />
      </div>
      <Button type="submit" size="lg" className="h-11">
        Search
      </Button>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).q;
  const query = cleanSearchQuery(Array.isArray(raw) ? raw[0] : raw);
  if (!query) {
    return (
      <div className="space-y-4">
        <SearchForm query="" />
        <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-sm">
          Try
          {EXAMPLES.map((example) => (
            <Link
              key={example}
              href={searchHref(example)}
              className="border-border/60 hover:border-primary/45 text-foreground inline-flex min-h-9 items-center rounded-full border px-3 transition-colors"
            >
              {example}
            </Link>
          ))}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* A page of results is useful to people, not to search engines. */}
      <meta name="robots" content="noindex, follow" />
      <SearchForm query={query} />
      <Suspense fallback={<ResultsSkeleton />}>
        <ResultList query={query} />
      </Suspense>
    </div>
  );
}

async function ResultList({ query }: { query: string }) {
  if (query.length < 2) return <p className="text-muted-foreground text-sm">Type at least two letters or numbers.</p>;
  const { cards, total, correction } = await searchPublicCards(query);
  if (!cards.length) {
    return (
      <p className="text-muted-foreground py-10 text-center text-sm">
        No cards match “{query}”.
        {correction && (
          <>
            {' '}
            Did you mean{' '}
            <Link href={searchHref(correction)} className="text-primary underline-offset-2 hover:underline">
              {correction}
            </Link>
            ?
          </>
        )}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">
        {total > cards.length
          ? `The first ${PUBLIC_SEARCH_LIMIT} of ${total} cards for “${query}”`
          : `${total} ${total === 1 ? 'card' : 'cards'} for “${query}”`}
      </h2>
      {total > cards.length && (
        <p className="text-muted-foreground text-sm">Add a set or a number to narrow it down.</p>
      )}
      <PublicCardGrid
        cards={cards}
        label={`Cards matching ${query}`}
        facets={['setName', 'rarity', 'illustrator']}
        sortLabels={{ default: 'Best match' }}
        textFilter={false}
        meta="set"
        links={{ binderHref: '/?view=sets' }}
      />
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6" aria-busy="true">
      <span className="sr-only">Searching</span>
      {Array.from({ length: 12 }, (_, i) => (
        <Skeleton key={i} className="trading-card w-full rounded-2xl" />
      ))}
    </div>
  );
}
