import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { PublicCardGrid } from '@/components/public-card-grid';
import { CatalogueFact, PublicCataloguePage } from '@/components/public-catalogue-page';
import { Button } from '@/components/ui/button';
import { getPublicSetCards, getPublicSets, type PublicSetCard } from '@/lib/server/public-sets';
import { knownRarity, type CatalogueCard } from '@/lib/catalogue-cards';
import { findPokemonById } from '@/lib/pokemon-pages';
import { socialMetadata } from '@/lib/social-metadata';
import {
  blogSetGuideUrl,
  countSetCards,
  formatCardNumber,
  formatReleaseDate,
  pagesNeeded,
  type PublicSetSummary,
} from '@/lib/set-pages';

// Wait for the complete page so an unknown set's notFound() is a real 404, as the named binder shares do.
export const ensureStatic = 'navigation';

// One invalid build-time param, so the build never reads cards; each set renders on its first visit and is then
// served from cache until a card sync expires the card-catalog tag.
export function generateStaticParams() {
  return [{ slug: '-' }];
}

const load = cache(async (slug: string) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(slug)) notFound();
  const sets = await getPublicSets();
  const index = sets.findIndex((set) => set.slug === slug);
  if (index < 0) {
    // Catalogue APIs know sets by id ("sv03.5"); send those links to the set's page.
    const byId = sets.find((set) => set.id === slug);
    if (byId) permanentRedirect(`/sets/${byId.slug}`);
    notFound();
  }
  const set = sets[index];
  const cards = await getPublicSetCards(set.id);
  return { set, cards, newer: sets[index - 1], older: sets[index + 1] };
});

const pageUrl = (slug: string) => `https://holofolder.com/app/sets/${slug}`;
const cardNumber = (card: PublicSetCard, set: PublicSetSummary) => formatCardNumber(card.number, set.officialCardCount);

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { set, cards } = await load((await params).slug);
  const title = `${set.name} card list and checklist (${cards.length} cards)`;
  const description = `Every card in Pokémon TCG ${set.name}${set.releaseDate ? ` (released ${formatReleaseDate(set.releaseDate)})` : ''}: numbers, names, rarities and illustrators, with a printable checklist and the set laid out as nine-pocket binder pages.`;
  const images = set.logo ? [{ url: set.logo, alt: `${set.name} logo` }] : socialMetadata.openGraph.images;
  return {
    title,
    description,
    alternates: { canonical: pageUrl(set.slug) },
    openGraph: { ...socialMetadata.openGraph, title, description, url: pageUrl(set.slug), images },
    twitter: {
      ...socialMetadata.twitter,
      card: set.logo ? 'summary' : 'summary_large_image',
      title,
      description,
      images,
    },
  };
}

export default async function SetPage({ params }: Props) {
  const { set, cards, newer, older } = await load((await params).slug);
  const counts = countSetCards(
    cards.map((card) => card.number),
    set.officialCardCount,
  );
  const guide = blogSetGuideUrl(set.slug);
  const pageCount = pagesNeeded(counts.total);
  const summary = [
    `${set.name} has ${counts.total} cards in our catalogue.`,
    counts.base !== undefined &&
      `${counts.base} are numbered up to ${set.officialCardCount}` +
        (counts.secret ? ` and ${counts.secret} are secret rares numbered above it.` : '.'),
    `One copy of each fills ${pageCount} nine-pocket pages, or ${Math.ceil(pageCount / 2)} sheets used front and back.`,
    'Reverse holos and other finishes are not counted.',
  ]
    .filter(Boolean)
    .join(' ');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${set.name} card list and checklist`,
    url: pageUrl(set.slug),
    ...(set.releaseDate ? { datePublished: set.releaseDate } : {}),
    isPartOf: { '@type': 'WebSite', name: 'Holo Folder', url: 'https://holofolder.com' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: cards.length,
      itemListElement: cards.map((card, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: `${card.name} ${cardNumber(card, set)}`,
        ...(card.image ? { image: card.image } : {}),
      })),
    },
  };

  return (
    <PublicCataloguePage crumbs={[{ href: '/sets', label: 'All sets' }]} jsonLd={jsonLd}>
      <header className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-end">
        <div className="space-y-4">
          {set.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- set logo from our CDN, no resizing needed
            <img src={set.logo} alt={`${set.name} logo`} className="h-12 w-auto max-w-full object-contain sm:h-20" />
          )}
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              {[set.seriesName, set.releaseDate && `Released ${formatReleaseDate(set.releaseDate)}`]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              {set.name} card list and checklist
            </h1>
          </div>
          <p className="text-muted-foreground max-w-prose text-sm">{summary}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/?view=sets">Start this set as a binder, free</Link>
            </Button>
            {guide && (
              <Button asChild size="lg" variant="outline">
                <a href={guide}>Read the {set.name} set guide</a>
              </Button>
            )}
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-2 text-sm lg:grid-cols-2">
          <CatalogueFact label="Cards" value={String(counts.total)} />
          <CatalogueFact label="Pages" value={String(pageCount)} />
          {counts.base !== undefined && <CatalogueFact label="Base set" value={String(counts.base)} />}
          {counts.secret !== undefined && <CatalogueFact label="Secret" value={String(counts.secret)} />}
        </dl>
      </header>

      <div className="space-y-3">
        <h2 className="text-xl font-semibold">{set.name} checklist</h2>
        <PublicCardGrid
          cards={cards.map((card) => toCatalogueCard(card, set))}
          label={`${set.name} cards`}
          facets={['rarity', 'illustrator']}
          sortLabels={{ default: 'Number', reverse: 'Number, high first' }}
          meta="rarity"
          pages
          links={{ binderHref: '/?view=sets' }}
        />
      </div>

      {(newer || older) && (
        <nav aria-label="Other sets" className="grid grid-cols-2 gap-2 text-sm">
          {older ? <SetLink set={older} label="Older set" /> : <span />}
          {newer && <SetLink set={newer} label="Newer set" align="right" />}
        </nav>
      )}
    </PublicCataloguePage>
  );
}

function toCatalogueCard(card: PublicSetCard, set: PublicSetSummary): CatalogueCard {
  const pokemon = card.dexIds.length === 1 ? findPokemonById(card.dexIds[0]) : undefined;
  return {
    id: card.id,
    name: card.name,
    number: cardNumber(card, set),
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

function SetLink({ set, label, align }: { set: PublicSetSummary; label: string; align?: 'right' }) {
  return (
    <Link
      href={`/sets/${set.slug}`}
      className={`holo-tile flex min-h-11 flex-col justify-center rounded-xl px-3 py-2 ${align ? 'text-right' : ''}`}
    >
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-medium">{set.name}</span>
    </Link>
  );
}
