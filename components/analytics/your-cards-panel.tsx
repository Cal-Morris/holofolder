'use client';

import { useMemo, useState } from 'react';
import { Layers3 } from 'lucide-react';
import AnalyticsCardLine from '@/components/analytics/card-line';
import AnalyticsPanel from '@/components/analytics/panel';
import { Select } from '@/components/ui/select';
import { formatCardFinishLabel, formatCardLanguageLabel } from '@/lib/card-labels';
import type { buildNativeAnalytics } from '@/lib/collection/native-analytics';
import { formatGbpAmount } from '@/lib/price-format';

type Summary = NonNullable<ReturnType<typeof buildNativeAnalytics>>;
type Row = Summary['rows'][number];
const PAGE = 40;
const SORTS = { value: 'Value: high to low', name: 'Name', set: 'Set' } as const;
type Sort = keyof typeof SORTS;
const rowName = (r: Row) => r.name ?? (r.speciesNames.join(', ') || 'Unknown card');

/** Every copy with its saved value, sortable and paged. */
export default function AnalyticsYourCardsPanel({ summary }: { summary: Summary }) {
  const [sort, setSort] = useState<Sort>('value');
  const [page, setPage] = useState(0);
  const copyById = useMemo(() => new Map(summary.copies.map((c) => [c.itemId, c])), [summary.copies]);
  const rows = useMemo(
    () =>
      summary.rows.toSorted((a, b) =>
        sort === 'value'
          ? (copyById.get(b.itemId)?.amountGbp ?? -1) - (copyById.get(a.itemId)?.amountGbp ?? -1)
          : sort === 'set'
            ? (a.setName ?? '').localeCompare(b.setName ?? '') || rowName(a).localeCompare(rowName(b))
            : rowName(a).localeCompare(rowName(b)),
      ),
    [summary.rows, copyById, sort],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / PAGE) - 1));
  return (
    <AnalyticsPanel icon={Layers3} title="Your cards" className="mt-3">
      <Select
        aria-label="Sort your cards"
        value={sort}
        onChange={(e) => {
          setSort(e.target.value as Sort);
          setPage(0);
        }}
      >
        {Object.entries(SORTS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </Select>
      <ul className="divide-border/50 mt-2 divide-y">
        {rows.slice(currentPage * PAGE, (currentPage + 1) * PAGE).map((row) => {
          const copy = copyById.get(row.itemId);
          return (
            <AnalyticsCardLine
              key={row.itemId}
              name={rowName(row)}
              image={row.image}
              detail={[
                row.setName,
                row.language ? formatCardLanguageLabel(row.language) : null,
                row.finish ? formatCardFinishLabel(row.finish) : null,
                row.location.kind === 'assigned'
                  ? row.location.collectionName
                  : row.location.kind === 'unassigned'
                    ? 'Not in a binder'
                    : 'Location unknown',
              ]
                .filter(Boolean)
                .join(' · ')}
              amount={row.graded ? 'Graded' : (formatGbpAmount(copy?.amountGbp) ?? 'Unknown')}
              sub={
                copy?.quote
                  ? copy.basis === 'raw-reference'
                    ? 'not counted'
                    : `${copy.quote.confidence} confidence`
                  : undefined
              }
            />
          );
        })}
      </ul>
      <div className="flex gap-4 pt-2">
        {currentPage > 0 && (
          <button type="button" className="min-h-9 underline" onClick={() => setPage(currentPage - 1)}>
            Previous
          </button>
        )}
        {rows.length > (currentPage + 1) * PAGE && (
          <button type="button" className="min-h-9 underline" onClick={() => setPage(currentPage + 1)}>
            Next
          </button>
        )}
      </div>
    </AnalyticsPanel>
  );
}
