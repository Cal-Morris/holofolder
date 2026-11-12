'use client';

import CardImage from '@/components/card-image';
import { BinderSlotGlare, TRADING_CARD_CORNER_RADIUS } from '@/components/binder/pokemon-slot';
import { displaySlotLabel, displaySlotPreview, type ReadOnlyDisplaySlot } from '@/lib/binder-display-model';
import type { BinderCardDisplay } from '@/lib/selected-slot-card-display';
import { formatPokemonDisplayName } from '@/lib/pokemon-catalog';
import { Check } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const LONG_PRESS_MS = 450;
/** While the binder wiggles, a finger only has to rest this long before the pocket can be dragged. */
const WIGGLE_PRESS_MS = 200;
const MOVE_TOLERANCE_PX = 8;

/**
 * A dropped pocket lands on a spring: a damped oscillation sampled into CSS linear(), so it overshoots its pocket
 * by about 8% and settles (a drag applied force, so a little bounce reads as physical). Pockets that were pushed
 * aside have no force behind them and just ease into place with the iOS sheet curve.
 */
const LAND_SPRING = `linear(${Array.from({ length: 41 }, (_, i) =>
  i === 40 ? '1' : (1 - Math.exp(-6 * (i / 40)) * Math.cos(7.5 * (i / 40))).toFixed(3),
).join(', ')})`;
const LAND_MS = 420;
const SHIFT_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SHIFT_MS = 260;

export interface PocketDrag {
  /** A pocket was picked up: the binder goes into layout editing (wiggle mode). */
  start: (id: string) => void;
  /** It was dropped on another pocket and takes that pocket's place. */
  drop: (id: string, targetId: string) => void;
}

/**
 * Picking a pocket up and dropping it on another. While the pointer is down the pocket is the pointer (inline
 * `translate`, no easing, no React state); once it lets go, the pocket springs into its new place, and any pocket the
 * move pushed aside slides there too.
 */
function usePocketDrag(id: string, onDrag: PocketDrag | undefined, editing: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  // Armed: the next move past the tolerance picks the pocket up instead of panning or cancelling.
  const armed = useRef(false);
  const arm = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ grabX: number; grabY: number; x: number; y: number; over: HTMLElement | null } | null>(null);
  // A finished touch drag still has its touchend to come; the binder's page swipe must not see it.
  const dragged = useRef(false);
  // Where it sat in the grid last render (offsets ignore transforms), and where a just-dropped pocket was drawn.
  const place = useRef<{ x: number; y: number; editing: boolean } | null>(null);
  const released = useRef<{ x: number; y: number } | null>(null);
  const landing = useRef<Animation | null>(null);
  // Slide from (x, y) back to the pocket's own place. Released pockets spring, pushed ones ease.
  const settle = (x: number, y: number, spring: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.style.translate = '';
    landing.current?.cancel();
    landing.current = null;
    if ((!x && !y) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    landing.current = el.animate([{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }], {
      duration: spring ? LAND_MS : SHIFT_MS,
      easing: spring && CSS.supports('transition-timing-function', 'linear(0, 1)') ? LAND_SPRING : SHIFT_EASE,
    });
  };
  // FLIP: after a render moves this pocket (a drop, an insert, a removal), slide it from where it was drawn.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = place.current;
    const now = { x: el.offsetLeft, y: el.offsetTop, editing };
    place.current = now;
    if (!was || drag.current) return;
    const dx = was.x - now.x,
      dy = was.y - now.y;
    if (released.current) {
      settle(released.current.x + dx, released.current.y + dy, true);
      released.current = null;
    } else if ((dx || dy) && was.editing && now.editing) settle(dx, dy, false);
  });
  const draggable = Boolean(onDrag);
  useEffect(
    () => () => {
      if (arm.current) clearTimeout(arm.current);
    },
    [],
  );
  useEffect(() => {
    const el = ref.current;
    if (!el || !draggable) return;
    // Touch scrolling and the page swipe listen to touch events, so a held or dragged pocket keeps them to itself.
    const onTouchMove = (event: TouchEvent) => {
      if (armed.current || drag.current) event.preventDefault();
      if (drag.current) event.stopPropagation();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (dragged.current) event.stopPropagation();
    };
    // eslint-disable-next-line react-doctor/client-passive-event-listeners -- it has to cancel the pan of a held pocket
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [draggable]);
  const disarm = () => {
    if (arm.current) {
      clearTimeout(arm.current);
      arm.current = null;
    }
  };
  const follow = (x: number, y: number) => {
    const el = ref.current,
      d = drag.current;
    if (!el || !d) return;
    // Relative to where the pocket sits now, so a bar appearing above the binder doesn't throw it off.
    const box = el.getBoundingClientRect();
    d.x = x - d.grabX - (box.left - d.x);
    d.y = y - d.grabY - (box.top - d.y);
    el.style.translate = `${d.x}px ${d.y}px`;
    const over =
      document
        .elementsFromPoint(x, y)
        .map((node) => node.closest<HTMLElement>('button[data-slot-id]'))
        .find((node) => node && node !== el) ?? null;
    if (over !== d.over) {
      d.over?.removeAttribute('data-drop-target');
      over?.setAttribute('data-drop-target', '');
      d.over = over;
    }
  };
  const putDown = (drop: boolean) => {
    const el = ref.current,
      d = drag.current;
    armed.current = false;
    if (!el || !d) return;
    drag.current = null;
    delete el.dataset.dragging;
    d.over?.removeAttribute('data-drop-target');
    const target = d.over?.dataset.slotId;
    // Stays where the pointer let go; the next render (the move) or the next frame (no move) springs it home.
    released.current = { x: d.x, y: d.y };
    if (drop && target) onDrag?.drop(id, target);
    requestAnimationFrame(() => {
      if (!released.current) return;
      const { x, y } = released.current;
      released.current = null;
      settle(x, y, true);
    });
  };
  return {
    ref,
    disarm,
    up: () => putDown(true),
    cancel: () => putDown(false),
    /** The long press opened the menu: from here, moving the finger picks the pocket up. */
    holdArms: () => {
      armed.current = draggable;
    },
    down: (event: ReactPointerEvent<HTMLButtonElement>, wiggling: boolean) => {
      origin.current = { x: event.clientX, y: event.clientY };
      dragged.current = false;
      disarm();
      armed.current = Boolean(onDrag && event.pointerType === 'mouse' && event.button === 0);
      if (onDrag && wiggling && event.pointerType !== 'mouse')
        arm.current = setTimeout(() => {
          arm.current = null;
          armed.current = true;
        }, WIGGLE_PRESS_MS);
    },
    /** 'dragging' while it follows the pointer, 'picked' the moment it lifts, otherwise null. */
    move: (event: ReactPointerEvent<HTMLButtonElement>): 'dragging' | 'picked' | null => {
      if (drag.current) {
        follow(event.clientX, event.clientY);
        return 'dragging';
      }
      const el = ref.current;
      const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > MOVE_TOLERANCE_PX;
      if (!el || !onDrag || !armed.current || !moved || (event.pointerType === 'mouse' && event.buttons !== 1))
        return null;
      disarm();
      armed.current = false;
      dragged.current = true;
      // Caught mid-landing: measure from where it rests, the pointer re-grabs it from there.
      landing.current?.cancel();
      landing.current = null;
      released.current = null;
      const box = el.getBoundingClientRect();
      drag.current = { grabX: origin.current.x - box.left, grabY: origin.current.y - box.top, x: 0, y: 0, over: null };
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        /* Not an active pointer (a synthetic event); touch is captured implicitly anyway. */
      }
      el.dataset.dragging = '';
      onDrag.start(id);
      follow(event.clientX, event.clientY);
      return 'picked';
    },
    dragging: () => drag.current !== null,
  };
}

/**
 * One binder pocket. A tap selects it. Where the host offers pocket actions (`onMenu`), a right-click, the keyboard
 * menu key or a long press opens them instead; a long press is dropped as soon as the finger pans, scrolls or
 * turns the page, and never also counts as a tap. `marked` shows layout selection on the pocket itself.
 *
 * Where the host offers `onDrag`, a pocket can be picked up and dropped on another: a mouse drags straight away, a
 * finger keeps holding after the long press (or, while the binder wiggles, rests briefly) and then moves.
 */
export function OrderedSlot({
  slot,
  slotLabel,
  selected,
  onSelect,
  onMenu,
  onDrag,
  marked,
  dimmed,
  imageSizes,
  glareStyle,
  glare,
  interactionKey,
  cardDisplay,
  priceLabel,
}: {
  /** The saved market price shown on the pocket in the Prices view. */
  priceLabel?: string | null;
  cardDisplay?: BinderCardDisplay;
  interactionKey?: string;
  slot: ReadOnlyDisplaySlot;
  slotLabel?: string;
  selected: boolean;
  onSelect: (id: string) => void;
  onMenu?: (id: string, point: { x: number; y: number }) => void;
  onDrag?: PocketDrag;
  /** Layout selection: undefined outside layout editing, otherwise whether this pocket is selected. */
  marked?: boolean;
  dimmed?: boolean;
  imageSizes: string;
  glareStyle: CSSProperties;
  glare: boolean;
}) {
  const coordinateId = useId();
  const press = useRef<{ key: string | undefined; x: number; y: number } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const pocketDrag = usePocketDrag(slot.id, onDrag, marked !== undefined);
  const { ref } = pocketDrag;
  const cancelHold = () => {
    if (hold.current) {
      clearTimeout(hold.current);
      hold.current = null;
    }
    pocketDrag.disarm();
  };
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  const { image, isCard: hasCardImage, tone } = displaySlotPreview(slot, cardDisplay);
  return (
    <button
      ref={ref}
      type="button"
      data-slot-id={slot.id}
      aria-label={displaySlotLabel(slot)}
      aria-describedby={slotLabel ? coordinateId : undefined}
      aria-pressed={marked ?? selected}
      draggable={false}
      aria-haspopup={onMenu ? 'menu' : undefined}
      onPointerDown={(event) => {
        press.current = { key: interactionKey, x: event.clientX, y: event.clientY };
        held.current = false;
        cancelHold();
        pocketDrag.down(event, marked !== undefined);
        if (!onMenu || event.pointerType === 'mouse') return;
        const point = { x: event.clientX, y: event.clientY };
        hold.current = setTimeout(() => {
          hold.current = null;
          if (!press.current) return;
          held.current = true;
          press.current = null;
          pocketDrag.holdArms();
          onMenu(slot.id, point);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        const drag = pocketDrag.move(event);
        if (drag === 'picked') {
          // Picked up: no tap, no menu.
          cancelHold();
          press.current = null;
          held.current = true;
        }
        if (drag) return;
        if (
          press.current &&
          Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y) > MOVE_TOLERANCE_PX
        ) {
          press.current = null;
          cancelHold();
        }
      }}
      onPointerUp={() => {
        cancelHold();
        pocketDrag.up();
      }}
      onPointerLeave={() => {
        if (!pocketDrag.dragging()) cancelHold();
      }}
      onPointerCancel={() => {
        press.current = null;
        cancelHold();
        pocketDrag.cancel();
      }}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        cancelHold();
        // A touch long press may already have opened the menu; the platform's own event then only needs suppressing.
        if (held.current) return;
        press.current = null;
        const box = event.currentTarget.getBoundingClientRect();
        onMenu(
          slot.id,
          event.clientX || event.clientY
            ? { x: event.clientX, y: event.clientY }
            : { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        );
      }}
      onClick={(event) => {
        const allowed =
          !held.current && (event.detail === 0 || (press.current !== null && press.current.key === interactionKey));
        press.current = null;
        held.current = false;
        if (allowed) onSelect(slot.id);
      }}
      className={`relative h-full min-h-9 w-full min-w-9 overflow-hidden text-white select-none [-webkit-touch-callout:none] active:scale-[0.98] ${hasCardImage ? 'bg-transparent' : 'border border-white/25 bg-white/10 shadow-inner'} ${marked || (marked === undefined && selected) ? 'border-primary ring-primary ring-2' : hasCardImage ? 'ring-1 ring-black/5 dark:ring-white/6' : ''} ${dimmed ? 'opacity-45' : ''} ${marked !== undefined ? 'pocket-wiggle' : ''}`}
      style={{ borderRadius: TRADING_CARD_CORNER_RADIUS }}
    >
      {image && (
        <CardImage
          key={`${slot.id}:${image}`}
          src={image}
          alt=""
          fill
          sizes={imageSizes}
          className={`${hasCardImage ? 'object-cover' : 'object-contain p-[3px]'} ${tone}`}
          draggable={false}
        />
      )}
      {/* Same pocket coordinate badge as the legacy PokemonSlot. */}
      {slotLabel && (
        <span
          id={coordinateId}
          className="absolute top-0.5 left-0.5 z-10 hidden rounded bg-white/74 px-1 py-0.5 text-[7px] font-bold text-slate-600 tabular-nums sm:top-1 sm:left-1 sm:block sm:text-[8px] dark:bg-black/50 dark:text-white/70"
        >
          {slotLabel}
        </span>
      )}
      {marked !== undefined && (
        <span
          aria-hidden="true"
          data-pocket-mark={marked ? 'selected' : 'available'}
          className={`absolute top-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 shadow ${marked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/85 bg-black/35'}`}
        >
          {marked && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
      )}
      <span className="sr-only">
        <span className="block truncate">
          {slot.card?.name ??
            (slot.pokemon
              ? formatPokemonDisplayName(slot.pokemon.name)
              : slot.target?.kind === 'pokemon'
                ? `Pokémon ${slot.target.pokemonId}`
                : 'Free slot')}
        </span>
        <span className="block truncate">{slot.item ? 'Owned' : slot.target ? 'Unfilled target' : 'Empty spacer'}</span>
        {slot.item?.grading && (
          <span className="block truncate">Recorded grade: {slot.item.grading.grade ?? 'Unknown'}</span>
        )}
      </span>
      {/* Prices view: the owned copy's market price, over the card's foot like the legacy pocket subtitle. */}
      {priceLabel && (
        <span className="absolute inset-x-0.5 bottom-0.5 z-10 truncate rounded bg-black/72 px-1 py-0.5 text-center text-[9px] font-semibold text-white tabular-nums sm:text-[10px]">
          {priceLabel}
        </span>
      )}
      {glare && <BinderSlotGlare glareStyle={glareStyle} innerRadius={TRADING_CARD_CORNER_RADIUS} />}
    </button>
  );
}
