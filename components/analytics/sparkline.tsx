/** Oldest to now, from one price source. Decorative: the % and timeframe next to it carry the meaning. */
export default function AnalyticsSparkline({ points, good }: { points: number[]; good: boolean }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const span = Math.max(...points) - min || 1;
  const path = points.map((p, i) => `${(i / (points.length - 1)) * 56 + 2},${22 - ((p - min) / span) * 18}`).join(' ');
  return (
    <svg viewBox="0 0 60 24" className="h-6 w-15 shrink-0" aria-hidden="true">
      <polyline
        points={path}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={good ? 'stroke-highlight' : 'stroke-destructive'}
      />
    </svg>
  );
}
