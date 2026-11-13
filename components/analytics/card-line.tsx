import Image from 'next/image';
import AnalyticsSparkline from '@/components/analytics/sparkline';
import { toCardImageSrc } from '@/lib/card-image-url';

const TONE = { good: 'text-highlight', bad: 'text-destructive', muted: 'text-muted-foreground' } as const;

/** A card row: thumbnail, name and detail, an optional sparkline, then the amount with an optional line under it. */
export default function AnalyticsCardLine({
  name,
  image,
  detail,
  amount,
  sub,
  tone = 'muted',
  spark,
}: {
  name: string;
  image: string | null | undefined;
  detail: string;
  amount: string;
  sub?: string;
  /** Colours the sub line, or the amount when there is no sub line (muted leaves the amount plain). */
  tone?: keyof typeof TONE;
  spark?: number[];
}) {
  const src = toCardImageSrc(image);
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="bg-muted relative block h-14 w-10 shrink-0 overflow-hidden rounded-md">
        {src && <Image src={src} alt={name} fill sizes="40px" unoptimized className="object-cover" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{name}</p>
        <p className="text-muted-foreground truncate text-xs">{detail}</p>
      </div>
      {spark && <AnalyticsSparkline points={spark} good={tone !== 'bad'} />}
      <div className="shrink-0 text-right text-sm font-semibold tabular-nums">
        <span className={sub || tone === 'muted' ? undefined : TONE[tone]}>{amount}</span>
        {sub && <span className={`block text-xs font-normal ${TONE[tone]}`}>{sub}</span>}
      </div>
    </li>
  );
}
