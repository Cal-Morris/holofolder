'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { Grid3X3, Heart, ListChecks, Search, Ticket, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { OverlayCloseButton, OverlayDialog, OverlayFooter, OverlayHeader } from '@/components/ui/overlay-dialog';
import {
  availableCoachMarks,
  COACH_MARKS,
  TOUR_SLIDES,
  type CoachMark,
  type TourSlideIcon,
} from '@/lib/first-account-tour';

const ICONS: Record<TourSlideIcon, LucideIcon> = {
  binder: Grid3X3,
  inventory: ListChecks,
  wanted: Heart,
  search: Search,
  show: Ticket,
};

/** The first-account tour: intro slides, then coach marks on the real header and dock. Every close finishes it. */
export default function FirstAccountTour({ onFinish }: { onFinish: () => void }) {
  const [marks, setMarks] = useState<readonly CoachMark[] | null>(null);
  if (marks) return <CoachMarks marks={marks} onFinish={onFinish} />;
  return (
    <TourSlides
      onSkip={onFinish}
      onDone={() => {
        // The controls on screen now: the dock is phone-only and Show needs cards.
        const shown = availableCoachMarks(COACH_MARKS, (t) => !!shownRect(t));
        if (shown.length) setMarks(shown);
        else onFinish();
      }}
    />
  );
}

function TourSlides({ onSkip, onDone }: { onSkip: () => void; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement | null>(null);
  // Next's slide while its smooth scroll runs, so the scroll events on the way don't pull the count back.
  const steering = useRef<number | null>(null);
  const last = index === TOUR_SLIDES.length - 1;
  const next = () => {
    if (last) return onDone();
    const goal = index + 1;
    steering.current = goal;
    const el = track.current;
    el?.scrollTo({ left: goal * el.clientWidth, behavior: 'smooth' });
    setIndex(goal);
  };
  return (
    <OverlayDialog
      onClose={onSkip}
      aria-label="Welcome to Holo Folder"
      className="flex flex-col pr-[env(safe-area-inset-right)] pb-[var(--safe-bottom)] pl-[env(safe-area-inset-left)]"
    >
      <OverlayHeader className="border-b-0 px-4 pt-4 pb-0">
        <p className="text-muted-foreground text-xs font-semibold" aria-live="polite">
          {index + 1} of {TOUR_SLIDES.length}
        </p>
        <OverlayCloseButton label="Close tour" onClick={onSkip} className="-mr-2 h-11 w-11" />
      </OverlayHeader>
      {/* Swipe sideways between slides (native scroll snap); Next scrolls the same track. */}
      <div
        ref={track}
        onPointerDown={() => {
          steering.current = null;
        }}
        onScroll={(event) => {
          const el = event.currentTarget;
          const at = Math.round(el.scrollLeft / el.clientWidth);
          if (steering.current !== null && at !== steering.current) return;
          steering.current = null;
          setIndex(at);
        }}
        className="flex snap-x snap-mandatory [scrollbar-width:none] overflow-x-auto overscroll-x-contain"
      >
        {TOUR_SLIDES.map((slide, i) => {
          const Icon = ICONS[slide.icon];
          return (
            <section
              key={slide.title}
              aria-label={slide.title}
              aria-hidden={i !== index}
              className="flex w-full shrink-0 snap-center flex-col items-center px-6 pt-2 pb-4 text-center"
            >
              <span className="holo-tile text-primary flex size-14 items-center justify-center rounded-2xl">
                <Icon className="size-6" aria-hidden />
              </span>
              <h2 className="mt-4 text-lg font-semibold">{slide.title}</h2>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{slide.body}</p>
            </section>
          );
        })}
      </div>
      <div aria-hidden className="flex justify-center gap-1.5 pb-3">
        {TOUR_SLIDES.map((slide, i) => (
          <span
            key={slide.title}
            className={`h-1.5 rounded-full transition-[width,background-color] duration-200 motion-reduce:transition-none ${i === index ? 'bg-primary w-4' : 'bg-muted-foreground/30 w-1.5'}`}
          />
        ))}
      </div>
      <OverlayFooter className="px-4">
        <Button variant="outline" className="h-11 rounded-2xl" onClick={onSkip}>
          Skip
        </Button>
        <Button className="h-11 flex-1 rounded-2xl" onClick={next}>
          {last ? 'Show me around' : 'Next'}
        </Button>
      </OverlayFooter>
    </OverlayDialog>
  );
}

/** The first control matching `target` that is laid out on screen. */
const shownRect = (target: string) => {
  for (const el of document.querySelectorAll(target)) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
};

function CoachMarks({ marks, onFinish }: { marks: readonly CoachMark[]; onFinish: () => void }) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const mark = marks[index];
  useLayoutEffect(() => {
    const measure = () => setRect(shownRect(mark.target));
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [mark]);
  if (!rect) return null;
  const last = index === marks.length - 1;
  // Point from above for the dock, from below for the header; the card never sits on the control it explains.
  const above = rect.top > window.innerHeight / 2;
  return (
    <OverlayDialog
      onClose={onFinish}
      variant="centred"
      swipe={false}
      aria-label={`Tour: ${mark.title}`}
      className="max-w-sm p-4 backdrop:bg-black/30 backdrop:backdrop-blur-none"
      style={
        above ? { top: 'auto', bottom: window.innerHeight - rect.top + 12 } : { top: rect.bottom + 12, bottom: 'auto' }
      }
    >
      <span
        aria-hidden
        className="ring-primary pointer-events-none fixed rounded-xl ring-2"
        style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }}
      />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs font-semibold">
            {index + 1} of {marks.length}
          </p>
          <h2 className="mt-1 text-base font-semibold">{mark.title}</h2>
        </div>
        <OverlayCloseButton label="Close tour" onClick={onFinish} className="-mt-1 -mr-1 h-9 w-9" />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">{mark.body}</p>
      <div className="mt-3 flex justify-end gap-2">
        {!last && (
          <Button variant="ghost" className="h-10 rounded-2xl" onClick={onFinish}>
            Skip tour
          </Button>
        )}
        <Button className="h-10 rounded-2xl px-5" onClick={() => (last ? onFinish() : setIndex((i) => i + 1))}>
          {last ? 'Done' : 'Next'}
        </Button>
      </div>
    </OverlayDialog>
  );
}
