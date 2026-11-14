import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { CreditsNotice } from '@/components/credits';
import { PublicCardThumb } from '@/components/public-card-thumb';
import { Button } from '@/components/ui/button';
import { getOfficialArtworkUrl } from '@/lib/pokemon-artwork';
import { formatDexNumber } from '@/lib/pokemon-catalog';
import { findPokemonById, findPokemonBySlug, groupCardsBySet, type PublicPokemon } from '@/lib/pokemon-pages';
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
    <main className="bg-background safe-area-bottom min-h-screen px-4 py-8">
      <script
        type="application/ld+json"
        // JSON.stringify output with "<" escaped cannot close the script element.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      <div className="mx-auto max-w-2xl space-y-8">
        <header className="space-y-3">
          <nav aria-label="Breadcrumb" className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Link href="/" className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">
              Holo Folder
            </Link>
            <span aria-hidden>/</span>
            <Link href="/pokemon" className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">
              All Pokémon
            </Link>
          </nav>
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- resized by our image proxy */}
            <img
              src={getOfficialArtworkUrl(pokemon.id)}
              alt={`${pokemon.name} official artwork`}
              width={96}
              height={96}
              className="size-24 shrink-0 object-contain"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-muted-foreground text-sm tabular-nums">{formatDexNumber(pokemon.id)}</p>
              <h1 className="text-2xl font-semibold">{pokemon.name} Pokémon cards</h1>
            </div>
          </div>
          <p className="text-muted-foreground text-sm">
            {cards.length
              ? `${pokemon.name} has ${countLabel(cards.length)} in our catalogue, across ${setCount} ${setCount === 1 ? 'set' : 'sets'}. They are listed by series and set, newest first. Reverse holos and other finishes are not counted.`
              : `We don't hold any English ${pokemon.name} cards yet.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/?view=pokemon">Track your {pokemon.name} cards, free</Link>
            </Button>
          </div>
        </header>

        {groups.map((group) => (
          <section key={group.series} className="space-y-4">
            <h2 className="text-lg font-semibold">{group.series}</h2>
            {group.sets.map(({ set, cards }) => (
              <div key={set.id} className="space-y-1.5">
                <h3 className="text-sm font-semibold">
                  <Link
                    href={`/sets/${set.slug}`}
                    className="inline-flex min-h-9 items-center gap-1.5 underline-offset-2 hover:underline"
                  >
                    {set.name}
                    <span className="text-muted-foreground font-normal">({cards.length})</span>
                  </Link>
                </h3>
                <ol className="space-y-1.5">
                  {cards.map((card) => (
                    <li key={card.id} className="holo-tile flex items-center gap-3 rounded-xl p-2">
                      <PublicCardThumb thumb={card.thumb} alt={cardName(card, set)} className="w-10" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{card.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {[
                            formatCardNumber(card.number, set.officialCardCount),
                            card.rarity,
                            card.illustrator && `Illus. ${card.illustrator}`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </section>
        ))}

        {(previous || next) && (
          <nav aria-label="Other Pokémon" className="grid grid-cols-2 gap-2 text-sm">
            {previous ? <SpeciesLink pokemon={previous} /> : <span />}
            {next && <SpeciesLink pokemon={next} align="right" />}
          </nav>
        )}
        <CreditsNotice className="text-muted-foreground text-xs" />
      </div>
    </main>
  );
}

function SpeciesLink({ pokemon, align }: { pokemon: PublicPokemon; align?: 'right' }) {
  return (
    <Link
      href={`/pokemon/${pokemon.slug}`}
      className={`holo-tile flex min-h-11 flex-col justify-center rounded-xl px-3 py-2 ${align ? 'text-right' : ''}`}
    >
      <span className="text-muted-foreground text-xs tabular-nums">{formatDexNumber(pokemon.id)}</span>
      <span className="font-medium">{pokemon.name}</span>
    </Link>
  );
}
