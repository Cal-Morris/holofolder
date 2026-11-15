import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicCardGrid } from '@/components/public-card-grid';
import { CatalogueFact, PublicCataloguePage } from '@/components/public-catalogue-page';
import { Button } from '@/components/ui/button';
import { getOfficialArtworkUrl } from '@/lib/pokemon-artwork';
import { formatDexNumber } from '@/lib/pokemon-catalog';
import { findPokemonById, findPokemonBySlug, groupCardsBySet, type PublicPokemon } from '@/lib/pokemon-pages';
import { toPublicCatalogueCard } from '@/lib/server/public-catalogue-card';
import { getPublicPokemonCards, type PublicPokemonCard } from '@/lib/server/public-pokemon';
import { getPublicSets } from '@/lib/server/public-sets';
import { formatCardNumber, type PublicSetSummary } from '@/lib/set-pages';
import { socialMetadata } from '@/lib/social-metadata';

// Wait for the complete page so an unknown species' notFound() is a real 404, as the set pages do.
export const ensureStatic = 'navigation';

// One invalid build-time param, so the build never reads cards; each species renders on its first visit and is
// then served from cache until a card sync expires the card-catalog tag.
export function generateStaticParams() {
  return [{ slug: '-' }];
}

const load = cache(async (slug: string) => {
  const pokemon = findPokemonBySlug(slug);
  if (!pokemon) notFound();
  const [cards, sets] = await Promise.all([getPublicPokemonCards(pokemon.id), getPublicSets()]);
  return {
    pokemon,
    cards,
    groups: groupCardsBySet(cards, sets),
    previous: findPokemonById(pokemon.id - 1),
    next: findPokemonById(pokemon.id + 1),
  };
});

const pageUrl = (slug: string) => `https://holofolder.com/app/pokemon/${slug}`;
const cardName = (card: PublicPokemonCard, set: PublicSetSummary) =>
  `${card.name} ${formatCardNumber(card.number, set.officialCardCount)} ${set.name}`;
const countLabel = (n: number) => `${n} English ${n === 1 ? 'card' : 'cards'}`;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pokemon, cards, groups } = await load((await params).slug);
  const setCount = groups.reduce((n, group) => n + group.sets.length, 0);
  const title = `${pokemon.name} Pokémon cards: every English card (${cards.length})`;
  const description = cards.length
    ? `All ${countLabel(cards.length)} of ${pokemon.name} (${formatDexNumber(pokemon.id)}) across ${setCount} ${setCount === 1 ? 'set' : 'sets'}, newest first, with card numbers, rarities and illustrators.`
    : `${pokemon.name} (${formatDexNumber(pokemon.id)}) has no English cards in our catalogue yet.`;
  const images = [{ url: `https://holofolder.com${getOfficialArtworkUrl(pokemon.id, 480)}`, alt: pokemon.name }];
  return {
    title,
    description,
    alternates: { canonical: pageUrl(pokemon.slug) },
    // A species with no cards yet has nothing to rank for; it is indexed once its first card is synced.
    ...(cards.length ? {} : { robots: { index: false, follow: true } }),
    openGraph: { ...socialMetadata.openGraph, title, description, url: pageUrl(pokemon.slug), images },
    twitter: { ...socialMetadata.twitter, card: 'summary', title, description, images },
  };
}

export default async function PokemonPage({ params }: Props) {
  const { pokemon, cards, groups, previous, next } = await load((await params).slug);
  const setCount = groups.reduce((n, group) => n + group.sets.length, 0);
  const ordered = groups.flatMap((group) =>
    group.sets.flatMap(({ set, cards }) => cards.map((card) => ({ card, set }))),
  );
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${pokemon.name} Pokémon cards`,
    url: pageUrl(pokemon.slug),
    isPartOf: { '@type': 'WebSite', name: 'Holo Folder', url: 'https://holofolder.com' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: ordered.length,
      itemListElement: ordered.map(({ card, set }, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: cardName(card, set),
        ...(card.image ? { image: card.image } : {}),
      })),
    },
  };

  return (
    <PublicCataloguePage crumbs={[{ href: '/pokemon', label: 'All Pokémon' }]} jsonLd={jsonLd}>
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
          {/* eslint-disable-next-line @next/next/no-img-element -- resized by our image proxy */}
          <img
            src={getOfficialArtworkUrl(pokemon.id, 240)}
            alt={`${pokemon.name} official artwork`}
            width={160}
            height={160}
            className="size-28 shrink-0 object-contain sm:size-40"
          />
          <div className="min-w-0 space-y-3">
            <div className="space-y-2">
              <p className="text-muted-foreground text-sm tabular-nums">{formatDexNumber(pokemon.id)}</p>
              <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                {pokemon.name} Pokémon cards
              </h1>
            </div>
            <p className="text-muted-foreground max-w-prose text-sm">
              {cards.length
                ? `${pokemon.name} has ${countLabel(cards.length)} in our catalogue, across ${setCount} ${setCount === 1 ? 'set' : 'sets'}, newest first. Reverse holos and other finishes are not counted.`
                : `We don't hold any English ${pokemon.name} cards yet.`}
            </p>
            <Button asChild size="lg">
              <Link href="/?view=pokemon">Track your {pokemon.name} cards, free</Link>
            </Button>
          </div>
        </div>
        {cards.length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <CatalogueFact label="English cards" value={String(cards.length)} />
            <CatalogueFact label="Sets" value={String(setCount)} />
            <CatalogueFact label="Newest" value={ordered[0].set.name} />
            <CatalogueFact label="First card" value={ordered.at(-1)!.set.name} />
          </dl>
        )}
      </header>

      {cards.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold">Every {pokemon.name} card</h2>
          <PublicCardGrid
            cards={ordered.map(({ card, set }) => toPublicCatalogueCard(card, set))}
            label={`${pokemon.name} cards`}
            facets={['series', 'setName', 'rarity', 'illustrator']}
            sortLabels={{ default: 'Newest', reverse: 'Oldest' }}
            meta="set"
            links={{ binderHref: '/?view=pokemon' }}
          />
        </div>
      )}

      {(previous || next) && (
        <nav aria-label="Other Pokémon" className="grid grid-cols-2 gap-2 text-sm">
          {previous ? <SpeciesLink pokemon={previous} /> : <span />}
          {next && <SpeciesLink pokemon={next} align="right" />}
        </nav>
      )}
    </PublicCataloguePage>
  );
}

function SpeciesLink({ pokemon, align }: { pokemon: PublicPokemon; align?: 'right' }) {
  return (
    <Link
      href={`/pokemon/${pokemon.slug}`}
      className={`holo-tile flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 ${align ? 'flex-row-reverse text-right' : ''}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- resized by our image proxy */}
      <img
        src={getOfficialArtworkUrl(pokemon.id, 96)}
        alt=""
        loading="lazy"
        width={48}
        height={48}
        className="size-12 shrink-0 object-contain"
      />
      <span className="min-w-0">
        <span className="text-muted-foreground block text-xs tabular-nums">{formatDexNumber(pokemon.id)}</span>
        <span className="block truncate font-medium">{pokemon.name}</span>
      </span>
    </Link>
  );
}
