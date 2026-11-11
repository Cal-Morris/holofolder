'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import { computeVirtualRange, estimateRowHeight } from '@/lib/virtual-list';

interface Options {
  keys: ReadonlyArray<string | number>;
  /** Gap between rows in px (the list's `space-y-*`). */
  gap: number;
  estimatedRowHeight: number;
  overscanPx?: number;
  /** Until the scroller has been measured (first render). */
  initialViewportHeight?: number;
}

/**
 * Renders only the rows near the scroller's viewport. Row heights are measured as rows render (by key, so
 * they survive filtering) and the rest are estimated. Returns the range to render, the scroller ref callback and
 * scroll handler, and a ref callback for each rendered row (which needs `data-virtual-key`).
 */
export function useVirtualRows({
  keys,
  gap,
  estimatedRowHeight,
  overscanPx = 800,
  initialViewportHeight = 900,
}: Options) {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(initialViewportHeight);
  // Measured heights: collected in a ref by the observer, published as state once per frame.
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(() => new Map());
  const heightsRef = useRef(new Map<string, number>());
  const rowObserverRef = useRef<ResizeObserver | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const measureFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      rowObserverRef.current?.disconnect();
      rowObserverRef.current = null;
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current);
    },
    [],
  );

  /** Ref callback for the scroll container: tracks its height (fires once on observe, then on resize). */
  const attachScroller = useCallback(
    (scroller: HTMLElement | null) => {
      if (!scroller || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(() => setViewportHeight(scroller.clientHeight || initialViewportHeight));
      observer.observe(scroller);
      return () => observer.disconnect();
    },
    [initialViewportHeight],
  );

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      setScrollTop(target.scrollTop);
    });
  }, []);

  const range = useMemo(() => {
    const estimate = estimateRowHeight(heights.values(), estimatedRowHeight);
    return computeVirtualRange({
      count: keys.length,
      getHeight: (index) => heights.get(String(keys[index])) ?? estimate,
      gap,
      scrollTop,
      viewportHeight,
      overscanPx,
    });
  }, [keys, gap, estimatedRowHeight, scrollTop, viewportHeight, overscanPx, heights]);

  /** Ref callback for each rendered row (needs `data-virtual-key`). */
  const measureRow = useCallback((element: HTMLElement | null) => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    if (!rowObserverRef.current) {
      rowObserverRef.current = new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const row = entry.target as HTMLElement;
          const key = row.dataset.virtualKey;
          const height = row.offsetHeight;
          if (key === undefined || height <= 0 || heightsRef.current.get(key) === height) continue;
          heightsRef.current.set(key, height);
          changed = true;
        }
        if (changed && measureFrameRef.current === null) {
          measureFrameRef.current = requestAnimationFrame(() => {
            measureFrameRef.current = null;
            setHeights(new Map(heightsRef.current));
          });
        }
      });
    }
    const observer = rowObserverRef.current;
    observer.observe(element);
    return () => observer.unobserve(element);
  }, []);

  return { range, attachScroller, onScroll, measureRow };
}
