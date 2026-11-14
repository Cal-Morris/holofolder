import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicCardGrid } from '@/components/public-card-grid';
import { CatalogueFact, PublicCataloguePage } from '@/components/public-catalogue-page';
import { Button } from '@/components/ui/button';
import { knownRarity, type CatalogueCard } from '@/lib/catalogue-cards';
import type { IllustratorCard } from '@/lib/illustrators';
import { findPokemonById } from '@/lib/pokemon-pages';
import { getPublicIllustratorCards, getPublicIllustrators } from '@/lib/server/public-illustrators';
import { getPublicSets } from '@/lib/server/public-sets';
import { formatCardNumber, type PublicSetSummary } from '@/lib/set-pages';
import { socialMetadata } from '@/lib/social-metadata';

// Wait for the complete page so an unknown illustrator's notFound() is a real 404, as the set pages do.
export const ensureStatic = 'navigation';

// One invalid build-time param, so the build never reads cards; each illustrator renders on its first visit and is
// then served from cache until a card sync expires the card-catalog tag.
export function generateStaticParams() {
  return [{ slug: '-' }];
}

const BLOG_POST = 'https://holofolder.com/blog/build-an-illustrator-collection';

const load = cache(async (slug: string) => {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) notFound();
  const illustrator = (await getPublicIllustrators()).find((entry) => entry.slug === slug);
  if (!illustrator) notFound();
  const [cards, sets] = await Promise.all([getPublicIllustratorCards(illustrator.names), getPublicSets()]);
  const setsById = new Map(sets.map((set) => [set.id, set]));
  const years = cards.flatMap((card) => setsById.get(card.set.id)?.releaseDate?.slice(0, 4) ?? []).toSorted();
  return {
    illustrator,
    cards: cards.map((card) => toCatalogueCard(card, setsById.get(card.set.id)!)),
    setCount: new Set(cards.map((card) => card.set.id)).size,
    years: years.length ? { first: years[0], last: years.at(-1)! } : undefined,
  };
});

const pageUrl = (slug: string) => `https://holofolder.com/app/illustrators/${slug}`;
const countLabel = (n: number) => `${n} English ${n === 1 ? 'card' : 'cards'}`;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { illustrator, cards, setCount } = await load((await params).slug);
  const title = `${illustrator.name} Pokémon cards: every English card illustrated (${cards.length})`;
  const description = cards.length
    ? `All ${countLabel(cards.length)} illustrated by ${illustrator.name} across ${setCount} ${setCount === 1 ? 'set' : 'sets'}, newest first, with card numbers and rarities.`
    : `We don't hold any English cards by ${illustrator.name} yet.`;
  const images = cards[0]?.image ? [{ url: cards[0].image, alt: cards[0].name }] : socialMetadata.openGraph.images;
  return {
    title,
    description,
    alternates: { canonical: pageUrl(illustrator.slug) },
    ...(cards.length ? {} : { robots: { index: false, follow: true } }),
    openGraph: { ...socialMetadata.openGraph, title, description, url: pageUrl(illustrator.slug), images },
    twitter: { ...socialMetadata.twitter, card: 'summary', title, description, images },
  };
}

export default async function IllustratorPage({ params }: Props) {
  const { illustrator, cards, setCount, years } = await load((await params).slug);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${illustrator.name} Pokémon cards`,
    url: pageUrl(illustrator.slug),
    isPartOf: { '@type': 'WebSite', name: 'Holo Folder', url: 'https://holofolder.com' },
    about: { '@type': 'Person', name: illustrator.name },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: cards.length,
      itemListElement: cards.map((card, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${card.name} ${card.number} ${card.setName}`,
        ...(card.image ? { image: card.image } : {}),
      })),
    },
  };

  return (
    <PublicCataloguePage crumbs={[{ href: '/illustrators', label: 'All illustrators' }]} jsonLd={jsonLd}>
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">Illustrator</p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {illustrator.name} Pokémon cards
            </h1>
          </div>
          <p className="text-muted-foreground max-w-prose text-sm">
            {cards.length
              ? `${illustrator.name} is credited on ${countLabel(cards.length)} in our catalogue, across ${setCount} ${setCount === 1 ? 'set' : 'sets'}, newest first. Reverse holos and other finishes are not counted.`
              : `We don't hold any English cards by ${illustrator.name} yet.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/?view=wanted">Collect {illustrator.name}&apos;s cards, free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href={BLOG_POST}>How to build an illustrator collection</a>
            </Button>
          </div>
        </div>
        {cards.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <CatalogueFact label="English cards" value={String(cards.length)} />
            <CatalogueFact label="Sets" value={String(setCount)} />
            {years && <CatalogueFact label="First card" value={years.first} />}
            {years && <CatalogueFact label="Latest card" value={years.last} />}
          </dl>
        )}
      </header>

      {cards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Every card by {illustrator.name}</h2>
          <PublicCardGrid
            cards={cards}
            label={`Cards by ${illustrator.name}`}
            facets={['series', 'setName', 'rarity']}
            sortLabels={{ default: 'Newest', reverse: 'Oldest' }}
            meta="set"
            links={{ binderHref: '/?view=sets' }}
          />
        </div>
      )}
    </PublicCataloguePage>
  );
}

function toCatalogueCard(card: IllustratorCard, set: PublicSetSummary): CatalogueCard {
  const pokemon = card.dexIds.length === 1 ? findPokemonById(card.dexIds[0]) : undefined;
  return {
    id: card.id,
    name: card.name,
    number: formatCardNumber(card.localId, set.officialCardCount),
    setName: set.name,
    setSlug: set.slug,
    ...(set.seriesName ? { series: set.seriesName } : {}),
    ...(set.releaseDate ? { releaseDate: set.releaseDate } : {}),
    ...(knownRarity(card.rarity) ? { rarity: card.rarity } : {}),
    ...(card.illustrator ? { illustrator: card.illustrator } : {}),
    ...(card.image ? { image: card.image } : {}),
    ...(pokemon ? { pokemon: { slug: pokemon.slug, name: pokemon.name } } : {}),
  };
}
