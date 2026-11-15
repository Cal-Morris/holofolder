'use client';

import { useState } from 'react';
import { getSetMonogram, publicSetArtworkUrl } from '@/lib/set-browse';
import type { TCGSetSummary } from '@/lib/tcg-set-slots';

/** A printed symbol for identifying a set, with a stable fallback offline or if artwork is unavailable. */
export function SetSymbol({
  set,
  compact = false,
}: {
  set: TCGSetSummary;
  /** Inline, in a chip. */ compact?: boolean;
}) {
  const src = publicSetArtworkUrl(set.symbol);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className={`flex shrink-0 items-center justify-center bg-white/90 font-bold text-slate-700 ${compact ? 'h-5 w-5 rounded-md p-0.5 text-[7px]' : 'h-9 w-9 rounded-lg p-1 text-[10px]'}`}
    >
      {src && failed !== src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(src)}
          className="h-full w-full object-contain"
        />
      ) : (
        getSetMonogram(set)
      )}
    </span>
  );
}
