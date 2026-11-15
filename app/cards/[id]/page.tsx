import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import CardImage from '@/components/card-image';
import { CardGridArt, CardGridBody, CardGridTile } from '@/components/card-grid-tile';
import { CatalogueFact, PublicCataloguePage } from '@/components/public-catalogue-page';
import { Button } from '@/components/ui/button';
import { knownRarity, publicCardPath } from '@/lib/catalogue-cards';
import { illustratorSlug } from '@/lib/illustrators';
import type { PublicCardPrice } from '@/lib/public-card-price';
import { toPublicCatalogueCard } from '@/lib/server/public-catalogue-card';
import { getOtherPrintings, getPublicCard, getPublicCardPrice } from '@/lib/server/public-cards';
import { formatReleaseDate } from '@/lib/set-pages';
import { socialMetadata } from '@/lib/social-metadata';

// Wait for the complete page so an unknown card's notFound() is a real 404, as the set pages do.
export const ensureStatic = 'navigation';

// One invalid build-time param, so the build never reads cards; each card renders on its first visit and is then
// served from cache (prices re-read daily, card facts until a card sync expires the card-catalog tag).
export function generateStaticParams() {
  return [{ id: '-' }];
}

const load = cache(async (rawId: string) => {
  const id = decodeURIComponent(rawId);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._~-]{0,80}$/.test(id)) notFound();
  const found = await getPublicCard(id);
  if (!found) notFound();
  const card = toPublicCatalogueCard(found.card, found.set);
  const [price, printings] = await Promise.all([getPublicCardPrice(id), getOtherPrintings(id, found.card.name)]);
  return {
    ...found,
    card,
    price,
    printings: printings.map((printing) => toPublicCatalogueCard(printing.card, printing.set)),
  };
});

const pageUrl = (id: string) => `https://holofolder.com/app/cards/${encodeURIComponent(id)}`;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { card } = await load((await params).id);
  const title = `${card.name} ${card.number} · ${card.setName}`;
  const description = `Pokémon TCG ${card.name} ${card.number} from ${card.setName}${card.rarity ? ` (${card.rarity})` : ''}${card.illustrator ? `, illustrated by ${card.illustrator}` : ''}: card details, market price and every other printing.`;
  const images = card.image
    ? [{ url: card.image, alt: `${card.name} ${card.number}` }]
    : socialMetadata.openGraph.images;
  return {
    title,
    description,
    alternates: { canonical: pageUrl(card.id) },
    openGraph: { ...socialMetadata.openGraph, title, description, url: pageUrl(card.id), images },
    twitter: { ...socialMetadata.twitter, card: 'summary', title, description, images },
  };
}

export default async function CardPage({ params }: Props) {
  const { card, set, category, hp, types, price, printings } = await load((await params).id);
  const setHref = `/sets/${set.slug}`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Sets', item: 'https://holofolder.com/app/sets' },
      { '@type': 'ListItem', position: 2, name: set.name, item: `https://holofolder.com/app/sets/${set.slug}` },
      { '@type': 'ListItem', position: 3, name: `${card.name} ${card.number}`, item: pageUrl(card.id) },
    ],
  };

  return (
    <PublicCataloguePage
      crumbs={[
        { href: '/sets', label: 'All sets' },
        { href: setHref, label: set.name },
      ]}
      jsonLd={jsonLd}
    >
      <header className="grid gap-6 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] sm:items-start">
        <div className="trading-card bg-muted/40 mx-auto w-52 sm:w-full">
          {card.image && (
            <CardImage
              src={card.image}
              alt={`${card.name} ${card.number}`}
              sizes="(max-width: 639px) 208px, 288px"
              preload
              className="h-full w-full"
            />
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <div className="space-y-2">
            <p className="text-muted-foreground text-sm">
              <Link href={setHref} className="inline-flex min-h-9 items-center underline-offset-2 hover:underline">
                {set.name}
              </Link>
              <span aria-hidden> · </span>
              <span className="tabular-nums">{card.number}</span>
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{card.name}</h1>
            {(card.rarity || (category && category !== 'Pokemon')) && (
              <p className="text-muted-foreground text-sm">
                {[card.rarity, category !== 'Pokemon' && category].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <PriceSection price={price} />
          <div className="flex flex-wrap gap-2">
            <Button asChild size="lg">
              <Link href="/?view=sets">Add to a binder, free</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/?view=wanted">Add to your want list</Link>
            </Button>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-3">
            <CatalogueFact label="Set" value={<Link href={setHref}>{set.name}</Link>} />
            <CatalogueFact label="Number" value={card.number} />
            {knownRarity(card.rarity) && <CatalogueFact label="Rarity" value={card.rarity} />}
            {card.illustrator && illustratorSlug(card.illustrator) && (
              <CatalogueFact
                label="Illustrator"
                value={<Link href={`/illustrators/${illustratorSlug(card.illustrator)}`}>{card.illustrator}</Link>}
              />
            )}
            {card.pokemon && (
              <CatalogueFact
                label="Pokémon"
                value={<Link href={`/pokemon/${card.pokemon.slug}`}>{card.pokemon.name}</Link>}
              />
            )}
            {card.releaseDate && <CatalogueFact label="Released" value={formatReleaseDate(card.releaseDate)} />}
            {hp && <CatalogueFact label="HP" value={String(hp)} />}
            {types.length > 0 && <CatalogueFact label={types.length > 1 ? 'Types' : 'Type'} value={types.join(', ')} />}
          </dl>
        </div>
      </header>

      {printings.length > 0 && (
        <section aria-labelledby="other-printings" className="space-y-3">
          <h2 id="other-printings" className="text-xl font-semibold">
            Other {card.name} printings
          </h2>
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
            {printings.map((printing) => (
              <CardGridTile
                key={printing.id}
                href={publicCardPath(printing)}
                openLabel={`${printing.name} ${printing.number}, ${printing.setName}`}
              >
                <CardGridArt
                  image={printing.image}
                  alt={`${printing.name} ${printing.number}`}
                  sizes="(max-width: 639px) 30vw, (max-width: 1023px) 20vw, 160px"
                />
                <CardGridBody>
                  <p className="truncate text-xs font-semibold">{printing.setName}</p>
                  <p className="text-muted-foreground truncate text-xs tabular-nums">{printing.number}</p>
                </CardGridBody>
              </CardGridTile>
            ))}
          </ul>
        </section>
      )}
    </PublicCataloguePage>
  );
}

function PriceSection({ price }: { price: PublicCardPrice | null }) {
  if (!price) {
    return (
      <p className="text-muted-foreground text-sm">
        We don&apos;t have enough recent marketplace quotes to show a confident price for this card yet.
      </p>
    );
  }
  const rows = price.finishes.length > 0 ? price.finishes : price.sources;
  return (
    <section aria-labelledby="card-price" className="holo-panel space-y-3 rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="card-price" className="text-sm font-semibold">
          Market price
        </h2>
        <p className="text-muted-foreground text-xs">
          {price.confidence === 'high' ? 'High' : 'Medium'} confidence
          {price.updated && ` · updated ${price.updated}`}
        </p>
      </div>
      <div>
        <p className="text-2xl font-semibold tabular-nums">{price.market}</p>
        {price.range && <p className="text-muted-foreground text-sm tabular-nums">Usually {price.range}</p>}
      </div>
      {rows.length > 0 && (
        <dl className="divide-border/50 divide-y text-sm">
          {rows.map((row) => (
            <div key={`${row.label}:${row.amount}`} className="flex min-h-9 items-center justify-between gap-3">
              <dt className="text-muted-foreground min-w-0 truncate">{row.label}</dt>
              <dd className="font-medium tabular-nums">{row.amount}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-muted-foreground text-xs">
        A guide to paying the right price, from recent marketplace quotes rather than sold listings.
      </p>
    </section>
  );
}
