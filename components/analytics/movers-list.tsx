import AnalyticsCardLine from '@/components/analytics/card-line';
import { insightDetail, momentumSparkline, type InsightCard } from '@/lib/collection/analytics-insights';
import { formatMomentumChange, type PriceMomentum } from '@/lib/price-momentum';
import { formatGbpAmount } from '@/lib/price-format';

/** Owned cards moving in price, with a sparkline from the same source as the %. Rising is good news for an owner. */
export default function AnalyticsMoversList({
  cards,
  rising,
}: {
  cards: (InsightCard & { momentum: PriceMomentum })[];
  rising: boolean;
}) {
  if (!cards.length)
    return (
      <p className="text-muted-foreground text-sm">
        Nothing {rising ? 'rising' : 'falling'} by enough right now. Only medium or high confidence prices count.
      </p>
    );
  return (
    <ul className="divide-border/50 -my-2 divide-y">
      {cards.map((card) => (
        <AnalyticsCardLine
          key={card.key}
          name={card.name}
          image={card.image}
          detail={insightDetail(card)}
          spark={momentumSparkline(card.quote, card.momentum)}
          tone={rising ? 'good' : 'bad'}
          amount={formatGbpAmount(card.momentum.currentGbpAmount) ?? 'Unknown'}
          sub={`${formatMomentumChange(card.momentum.change).replace('-', '−')} · ${card.momentum.timeframe}`}
        />
      ))}
    </ul>
  );
}
