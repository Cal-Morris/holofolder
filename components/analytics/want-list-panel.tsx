import { ShoppingBag } from 'lucide-react';
import AnalyticsCardLine from '@/components/analytics/card-line';
import AnalyticsPanel from '@/components/analytics/panel';
import type { buildWantListInsights } from '@/lib/collection/analytics-insights';
import { formatMomentumChange, type PriceMomentum } from '@/lib/price-momentum';
import { formatGbpAmount } from '@/lib/price-format';
import type { WantedDashboardCard } from '@/lib/wanted-dashboard';

type Insights = ReturnType<typeof buildWantListInsights>;
type Entry = { card: WantedDashboardCard; momentum?: PriceMomentum };

/** Want list cards worth a look: price drops, cheapest to tick off, and ones getting pricier. */
export default function AnalyticsWantListPanel({ insights }: { insights: Insights }) {
  const { total } = insights;
  const columns: { title: string; empty: string; entries: Entry[] }[] = [
    { title: 'Price dropped', empty: 'No wanted card has dropped enough right now.', entries: insights.drops },
    {
      title: 'Cheapest to tick off',
      empty: 'No reliable prices yet.',
      entries: insights.cheapest.map((card) => ({ card })),
    },
    { title: 'Getting pricier', empty: 'Nothing on your want list is climbing.', entries: insights.rising },
  ];
  return (
    <AnalyticsPanel
      icon={ShoppingBag}
      title="From your want list"
      className="mt-3"
      note={
        total.priced
          ? `${formatGbpAmount(total.totalGbp)} to buy the ${total.priced} reliably priced ${total.priced === 1 ? 'card' : 'cards'}${total.unknown ? `, plus ${total.unknown} without a reliable price` : ''}.`
          : `${insights.count} wanted, none with a reliable price yet.`
      }
    >
      <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
        {columns.map((column) => (
          <div key={column.title} className="min-w-0">
            <h3 className="text-sm font-medium">{column.title}</h3>
            {column.entries.length ? (
              <ul className="divide-border/50 divide-y">
                {column.entries.map(({ card, momentum }) => (
                  <AnalyticsCardLine
                    key={card.key}
                    name={card.card.card_name}
                    image={card.card.card_image}
                    detail={[card.card.card_set, card.binderName].filter(Boolean).join(' · ')}
                    amount={formatGbpAmount(card.effectiveGbpAmount) ?? 'Unknown'}
                    // A drop is good news when you're buying.
                    tone={momentum ? (momentum.change < 0 ? 'good' : 'bad') : 'muted'}
                    sub={
                      momentum
                        ? `${formatMomentumChange(momentum.change).replace('-', '−')} · ${momentum.timeframe}`
                        : undefined
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground mt-1 text-sm">{column.empty}</p>
            )}
          </div>
        ))}
      </div>
    </AnalyticsPanel>
  );
}
