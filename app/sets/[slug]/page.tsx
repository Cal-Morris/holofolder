import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { CreditsNotice } from '@/components/credits';
import { PublicCardThumb } from '@/components/public-card-thumb';
import { Button } from '@/components/ui/button';
import { getPublicSetCards, getPublicSets, type PublicSetCard } from '@/lib/server/public-sets';
import { getPokemonById } from '@/lib/pokemon-catalog';
import { pokemonSlug } from '@/lib/pokemon-pages';
import { socialMetadata } from '@/lib/social-metadata';
import {
  blogSetGuideUrl,
  countSetCards,
  formatCardNumber,
  formatReleaseDate,
  pagesNeeded,
  SET_PAGE_POCKETS,
  toBinderPages,
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
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) notFound();
  const sets = await getPublicSets();
  const index = sets.findIndex((set) => set.slug === slug);
  if (index < 0) notFound();
  const set = sets[index];
  const cards = await getPublicSetCards(set.id);
  return { set, cards, newer: sets[index - 1], older: sets[index + 1] };
});

const pageUrl = (slug: string) => `https://holofolder.com/app/sets/${slug}`;
const cardNumber = (card: PublicSetCard, set: PublicSetSummary) => formatCardNumber(card.number, set.officialCardCount);
// A card of one species links to that species' page; tag teams and Trainers don't.
const speciesHref = (card: PublicSetCard) => {
  const entry = card.dexIds.length === 1 ? getPokemonById(card.dexIds[0]) : undefined;
  return entry && `/pokemon/${pokemonSlug(entry)}`;
};
const cardAlt = (card: PublicSetCard, set: PublicSetSummary) => `${card.name} ${cardNumber(card, set)} ${set.name}`;

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
  const pages = toBinderPages(cards);
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
            <Link href="/sets" className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">
              All sets
            </Link>
          </nav>
          {set.logo && (
            // eslint-disable-next-line @next/next/no-img-element -- set logo from our CDN, no resizing needed
            <img src={set.logo} alt={`${set.name} logo`} className="h-16 w-auto max-w-full object-contain" />
          )}
          <h1 className="text-2xl font-semibold">{set.name} card list and checklist</h1>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {set.releaseDate && <Fact label="Released" value={formatReleaseDate(set.releaseDate)!} />}
            {set.seriesName && <Fact label="Series" value={set.seriesName} />}
            {counts.base !== undefined && <Fact label="Base set" value={`${counts.base} cards`} />}
            {counts.secret !== undefined && <Fact label="Secret rares" value={`${counts.secret} cards`} />}
            <Fact label="Cards in our catalogue" value={String(counts.total)} />
            <Fact label="Nine-pocket pages" value={String(pageCount)} />
          </dl>
          <p className="text-muted-foreground text-sm">{summary}</p>
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
        </header>

        <section aria-labelledby="checklist" className="space-y-2">
          <h2 id="checklist" className="text-lg font-semibold">
            {set.name} checklist
          </h2>
          <ol className="space-y-1.5">
            {cards.map((card) => (
              <li key={card.id} className="holo-tile flex items-center gap-3 rounded-xl p-2">
                <PublicCardThumb thumb={card.thumb} alt={cardAlt(card, set)} className="w-10" />
                <span className="min-w-0">
                  <SpeciesName card={card} />
                  <span className="text-muted-foreground block text-xs">
                    {[cardNumber(card, set), card.rarity, card.illustrator && `Illus. ${card.illustrator}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="binder-layout" className="space-y-3">
          <h2 id="binder-layout" className="text-lg font-semibold">
            {set.name} binder layout
          </h2>
          <p className="text-muted-foreground text-sm">
            In number order, {SET_PAGE_POCKETS} cards to a page: {pages.length} pages.
          </p>
          <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {pages.map((page, i) => (
              <li key={page[0].id} className="holo-panel space-y-2 rounded-2xl p-3">
                <h3 className="text-muted-foreground text-xs font-semibold">Page {i + 1}</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {page.map((card) => (
                    <PublicCardThumb key={card.id} thumb={card.thumb} alt={cardAlt(card, set)} className="w-full" />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </section>

        {(newer || older) && (
          <nav aria-label="Other sets" className="grid grid-cols-2 gap-2 text-sm">
            {older ? <SetLink set={older} label="Older set" /> : <span />}
            {newer && <SetLink set={newer} label="Newer set" align="right" />}
          </nav>
        )}
        <CreditsNotice className="text-muted-foreground text-xs" />
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="holo-tile rounded-xl px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function SpeciesName({ card }: { card: PublicSetCard }) {
  const href = speciesHref(card);
  return href ? (
    <Link href={href} className="flex min-h-9 items-center text-sm font-medium underline-offset-2 hover:underline">
      {card.name}
    </Link>
  ) : (
    <span className="block text-sm font-medium">{card.name}</span>
  );
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
