'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import CardImage from '@/components/card-image';
import { Button } from '@/components/ui/button';
import { OverlayCloseButton, OverlayDialog, OverlayGrabber } from '@/components/ui/overlay-dialog';
import { SimilarCardsRow } from '@/components/similar-cards-row';
import { catalogueCardFromSearch, type CatalogueCard } from '@/lib/catalogue-cards';
import { formatReleaseDate } from '@/lib/set-pages';

export interface PublicCardLinks {
  /** Where "Add to a binder" goes in the app, e.g. the Sets view on a set page. */
  binderHref: string;
}

/** A public catalogue card's read-only details: the card, its facts with links, and the way into the app. */
export default function PublicCardDetail({
  card,
  links,
  onOpenCard,
  onClose,
}: {
  card: CatalogueCard;
  links: PublicCardLinks;
  /** Show another card (a similar card tapped here) in this sheet. */
  onOpenCard: (card: CatalogueCard) => void;
  onClose: () => void;
}) {
  return (
    <OverlayDialog
      onClose={onClose}
      aria-labelledby="public-card-title"
      className="bg-card/97 dark:border-border/50 overflow-y-auto px-4 pt-3 pb-[calc(var(--safe-bottom)+1rem)] sm:max-w-lg"
    >
      <div data-sheet-grabber>
        <OverlayGrabber />
        <div className="flex items-start justify-between gap-2">
          <h2 id="public-card-title" className="pt-1.5 text-lg leading-tight font-semibold">
            {card.name}
          </h2>
          <OverlayCloseButton label="Close card details" onClick={onClose} className="-mt-1 -mr-2" />
        </div>
      </div>
      <div className="mt-3 flex gap-4">
        <div className="trading-card bg-muted/40 w-32 shrink-0 sm:w-44">
          {card.image && (
            <CardImage src={card.image} alt={`${card.name} ${card.number}`} sizes="176px" className="h-full w-full" />
          )}
        </div>
        <dl className="min-w-0 flex-1 space-y-2 text-sm">
          <Fact label="Set">
            {card.setSlug ? <Link href={`/sets/${card.setSlug}`}>{card.setName}</Link> : card.setName}
          </Fact>
          <Fact label="Number">{card.number}</Fact>
          {card.rarity && <Fact label="Rarity">{card.rarity}</Fact>}
          {card.illustrator && <Fact label="Illustrator">{card.illustrator}</Fact>}
          {card.releaseDate && <Fact label="Released">{formatReleaseDate(card.releaseDate)}</Fact>}
          {card.pokemon && (
            <Fact label="Pokémon">
              <Link href={`/pokemon/${card.pokemon.slug}`}>Every {card.pokemon.name} card</Link>
            </Fact>
          )}
        </dl>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button asChild size="lg">
          <Link href={links.binderHref}>Add to a binder, free</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/?view=wanted">Add to your want list</Link>
        </Button>
      </div>
      <div className="mt-5">
        <SimilarCardsRow
          cardId={card.id}
          language="en"
          onOpenCard={(similar) => onOpenCard(catalogueCardFromSearch(similar))}
        />
      </div>
    </OverlayDialog>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="[&_a]:text-primary font-medium break-words [&_a]:-my-2.5 [&_a]:inline-block [&_a]:py-2.5 [&_a]:underline-offset-2 hover:[&_a]:underline">
        {children}
      </dd>
    </div>
  );
}
