'use client';

import { useEffect, useState } from 'react';
import { getProxiedThumbnailUrl } from '@/lib/card-show-prep';
import type { CardLanguage } from '@/lib/domain/cards';
import { loadSimilarCards, type SimilarCard, type SimilarCardsResponse } from '@/lib/similar-cards';
import type { SearchCardResult } from '@/lib/pokemon-card-browse';

/**
 * "Same artwork" and "Similar look" rows for a card's detail: catalogue data, so it works signed out. Renders
 * nothing while loading, offline, on an error or when the card has no fingerprint, so it never gets in the way.
 */
export function SimilarCardsRow({
  cardId,
  language,
  onOpenCard,
}: {
  cardId: string;
  language: CardLanguage;
  onOpenCard: (card: SearchCardResult) => void;
}) {
  const [result, setResult] = useState<SimilarCardsResponse | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    loadSimilarCards(cardId, language, controller.signal)
      .then((payload) => {
        if (payload?.cardId === cardId) setResult(payload);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [cardId, language]);

  if (!result || result.cardId !== cardId || (!result.sameArtwork.length && !result.similarLook.length)) return null;
  return (
    <div className="animate-in fade-in space-y-3 duration-200 motion-reduce:animate-none" data-testid="similar-cards">
      <SimilarGroup title="Same artwork" cards={result.sameArtwork} onOpenCard={onOpenCard} />
      <SimilarGroup title="Similar look" cards={result.similarLook} onOpenCard={onOpenCard} />
    </div>
  );
}

function SimilarGroup({
  title,
  cards,
  onOpenCard,
}: {
  title: string;
  cards: SimilarCard[];
  onOpenCard: (card: SearchCardResult) => void;
}) {
  if (!cards.length) return null;
  return (
    <section aria-label={title}>
      <h3 className="text-muted-foreground mb-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase">
        {title} <span className="tabular-nums">· {cards.length}</span>
      </h3>
      <ul className="-mx-1 flex snap-x [scrollbar-width:none] gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1">
        {cards.map((card) => {
          const image = getProxiedThumbnailUrl(card.image);
          const label = `${card.name}, ${card.set.name} ${card.localId}`;
          return (
            <li key={`${card.id}:${card.language ?? ''}`} className="w-[88px] shrink-0 snap-start">
              <button
                type="button"
                onClick={() => onOpenCard(card)}
                aria-label={`Open ${label}`}
                className="bg-background/60 border-border/50 hover:border-primary/45 focus-visible:ring-primary/70 flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="trading-card bg-muted/40 relative block w-full">
                  {image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-muted-foreground flex h-full items-center justify-center p-2 text-center text-[11px]">
                      No image
                    </span>
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5 p-1.5">
                  <span className="truncate text-[11px] font-semibold" title={card.name}>
                    {card.name}
                  </span>
                  <span className="text-muted-foreground truncate text-[10px]" title={card.set.name}>
                    {card.set.name}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
