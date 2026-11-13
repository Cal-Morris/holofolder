'use client';

import CardImage from '@/components/card-image';
import { BinderSlotGlare, TRADING_CARD_CORNER_RADIUS } from '@/components/binder/pokemon-slot';
import { displaySlotLabel, displaySlotPreview, type ReadOnlyDisplaySlot } from '@/lib/binder-display-model';
import type { BinderCardDisplay } from '@/lib/selected-slot-card-display';
import { formatPokemonDisplayName } from '@/lib/pokemon-catalog';
import { Check } from 'lucide-react';
import type { PocketDropMode } from '@/lib/pocket-drop';
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
/** Resting a held card on a filled pocket this long makes room there (pushes cards on) instead of swapping. */
const MAKE_ROOM_MS = 550;
/** Resting a held card at the binder's side this long turns the page; resting on keeps turning at the repeat. */
const EDGE_TURN_MS = 650;
const EDGE_REPEAT_MS = 1000;
const EDGE_ZONE_PX = 28;
/** A second finger swiping this far sideways turns the page under a held card. */
const SWIPE_PX = 50;

/**
 * A dropped card lands on a spring: a damped oscillation sampled into CSS linear(), so it overshoots its pocket
 * by about 8% and settles (a drag applied force, so a little bounce reads as physical). Pockets that were pushed
 * aside have no force behind them and just ease into place with the iOS sheet curve.
 */
const LAND_SPRING = `linear(${Array.from({ length: 41 }, (_, i) =>
  i === 40 ? '1' : (1 - Math.exp(-6 * (i / 40)) * Math.cos(7.5 * (i / 40))).toFixed(3),
).join(', ')})`;
const LAND_MS = 420;
const SHIFT_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
const SHIFT_MS = 260;
/** How long a dropped card waits for its move to render before giving up and showing the binder as it is. */
const DROP_WAIT_MS = 1200;

export interface PocketDrag {
  /** A pocket was picked up: the binder goes into layout editing (wiggle mode). */
  start: (id: string) => void;
  /**
   * It was dropped on another pocket: `place` swaps them (or fills an empty one), `push` makes room there. Returns
   * false when nothing will move, so the card goes back.
   */
  drop: (id: string, targetId: string, mode: PocketDropMode) => boolean;
  /** Turn the page (or spread) under a held card: 1 forward, -1 back. */
  turn?: (direction: 1 | -1) => void;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * The card being dragged. It lives outside React and outside the pocket it came from, the way dnd-kit's DragOverlay
 * does: the card under the finger is a copy fixed to the viewport, so the page can turn (and the pocket it came from
 * unmount) without dropping it, nothing clips it, and no pocket moves until the drop.
 */
interface ActiveDrag {
  id: string;
  pointerId: number;
  source: HTMLElement;
  ghost: HTMLElement;
  stage: HTMLElement | null;
  grabX: number;
  grabY: number;
  x: number;
  y: number;
  carry: number;
  onDrag: PocketDrag;
  over: HTMLElement | null;
  mode: PocketDropMode;
  pushed: HTMLElement[];
  hold: Timer | null;
  edge: { dir: 1 | -1; timer: Timer; marker: HTMLElement } | null;
  refresh: Timer | null;
  swipe: { id: number; x: number; y: number; done: boolean } | null;
  detach: () => void;
}
let active: ActiveDrag | null = null;
/** Dropped cards waiting for their move to render: the pocket's layout effect says when it has. */
const landing = new Map<string, () => void>();

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* No haptics here. */
  }
};
const binderPockets = () => [...document.querySelectorAll<HTMLElement>('[data-binder-page] button[data-slot-id]')];

/** The pocket under the point, by where pockets sit, not where a gap preview draws them (so a preview can't flicker). */
function pocketAt(x: number, y: number, skip: HTMLElement) {
  return (
    binderPockets().find((el) => {
      if (el === skip) return false;
      const r = offsetRect(el);
      return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
    }) ?? null
  );
}

function clearPush(d: ActiveDrag) {
  for (const el of d.pushed) {
    el.style.translate = '';
    delete el.dataset.pushOut;
    setTimeout(() => {
      if (!el.style.translate) delete el.dataset.shifting;
    }, SHIFT_MS);
  }
  d.pushed = [];
}

/** Make room: the target and the filled pockets after it slide on one place, up to the first empty one (or the hole). */
function previewPush(d: ActiveDrag, target: HTMLElement) {
  const list = binderPockets();
  const rects = list.map(offsetRect);
  const first = list.indexOf(target);
  for (let i = first; i >= 0 && i < list.length; i++) {
    const el = list[i];
    if (el === d.source || el.dataset.filled === undefined) break;
    const next = rects[i + 1];
    el.dataset.shifting = '';
    if (next) el.style.translate = `${next.left - rects[i].left}px ${next.top - rects[i].top}px`;
    else el.dataset.pushOut = ''; // Pushed onto the next page.
    d.pushed.push(el);
  }
}

function setOver(d: ActiveDrag, over: HTMLElement | null) {
  if (over === d.over) return;
  if (d.hold) clearTimeout(d.hold);
  d.hold = null;
  if (d.over) delete d.over.dataset.dropTarget;
  clearPush(d);
  d.mode = 'place';
  d.over = over;
  if (!over) return;
  const filled = over.dataset.filled !== undefined;
  over.dataset.dropTarget = d.carry > 1 ? 'group' : filled ? 'swap' : 'place';
  if (d.carry > 1 || !filled) return;
  d.hold = setTimeout(() => {
    d.hold = null;
    if (active !== d || d.over !== over) return;
    d.mode = 'push';
    over.dataset.dropTarget = 'push';
    previewPush(d, over);
    buzz(15);
  }, MAKE_ROOM_MS);
}

function stopEdge(d: ActiveDrag) {
  if (!d.edge) return;
  clearTimeout(d.edge.timer);
  d.edge.marker.remove();
  d.edge = null;
}

function turnPage(d: ActiveDrag, dir: 1 | -1) {
  setOver(d, null);
  d.onDrag.turn?.(dir);
  buzz(10);
  // The pockets under a still finger change once the new page is in: look again then.
  if (d.refresh) clearTimeout(d.refresh);
  d.refresh = setTimeout(() => {
    d.refresh = null;
    if (active === d) track(d, d.x, d.y);
  }, 450);
}

/** Resting at either side of the binder turns the page after a beat, with a bar filling up to show it's coming. */
function edgeDwell(d: ActiveDrag, x: number) {
  const box = d.stage?.isConnected ? d.stage.getBoundingClientRect() : null;
  const dir = !box || !d.onDrag.turn ? 0 : x < box.left + EDGE_ZONE_PX ? -1 : x > box.right - EDGE_ZONE_PX ? 1 : 0;
  if (dir === (d.edge?.dir ?? 0)) return;
  stopEdge(d);
  if (!dir || !box) return;
  const arm = (delay: number): { dir: 1 | -1; timer: Timer; marker: HTMLElement } => {
    const marker = document.createElement('div');
    marker.dataset.pocketEdge = dir > 0 ? 'next' : 'previous';
    marker.setAttribute('aria-hidden', 'true');
    Object.assign(marker.style, {
      top: `${box.top}px`,
      height: `${box.height}px`,
      left: `${dir > 0 ? box.right - 6 : box.left}px`,
      animationDuration: `${delay}ms`,
    });
    document.body.append(marker);
    return {
      dir,
      marker,
      timer: setTimeout(() => {
        if (active !== d) return;
        marker.remove();
        turnPage(d, dir);
        d.edge = arm(EDGE_REPEAT_MS);
      }, delay),
    };
  };
  d.edge = arm(EDGE_TURN_MS);
}

function track(d: ActiveDrag, x: number, y: number) {
  d.x = x;
  d.y = y;
  d.ghost.style.translate = `${x - d.grabX}px ${y - d.grabY}px`;
  edgeDwell(d, x);
  setOver(d, d.edge ? null : pocketAt(x, y, d.source));
}

/** Put the card down: on the pocket it's over (`drop`), or back where it came from. */
function endDrag(d: ActiveDrag, drop: boolean) {
  if (active !== d) return;
  active = null;
  d.detach();
  for (const timer of [d.hold, d.refresh]) if (timer) clearTimeout(timer);
  stopEdge(d);
  for (const el of document.querySelectorAll<HTMLElement>('button[data-slot-id][data-carried]'))
    delete el.dataset.carried;
  const target = drop ? d.over : null;
  const targetId = target?.dataset.slotId;
  if (d.over) delete d.over.dataset.dropTarget;
  const pushed = d.pushed;
  const moved = Boolean(targetId && d.onDrag.drop(d.id, targetId, d.mode));
  if (!moved) clearPush(d);
  let flown = false,
    rendered = !moved;
  const finish = () => {
    if (!flown || !rendered) return;
    if (landing.get(d.id) === render) landing.delete(d.id);
    d.ghost.remove();
    delete d.source.dataset.dragSource;
    // A push that never rendered: the gap closes again.
    for (const el of pushed) if (el.style.translate) el.style.translate = '';
  };
  const render = () => {
    rendered = true;
    finish();
  };
  if (moved) {
    landing.set(d.id, render);
    setTimeout(() => {
      flown = rendered = true;
      finish();
    }, DROP_WAIT_MS);
  }
  // It flies into the pocket it lands in, or back to its own.
  const home = moved ? target! : d.source.isConnected ? d.source : null;
  const to = home ? offsetRect(home) : null;
  const flight =
    to && !reducedMotion()
      ? d.ghost.animate(
          [
            { translate: d.ghost.style.translate, scale: '1.06' },
            { translate: `${to.left}px ${to.top}px`, scale: '1' },
          ],
          {
            duration: LAND_MS,
            easing: CSS.supports('transition-timing-function', 'linear(0, 1)') ? LAND_SPRING : SHIFT_EASE,
            fill: 'forwards',
          },
        ).finished
      : Promise.resolve();
  void flight
    .catch(() => undefined)
    .then(() => {
      flown = true;
      finish();
    });
}

function pickUp(
  source: HTMLElement,
  id: string,
  pointerId: number,
  origin: { x: number; y: number },
  onDrag: PocketDrag,
  carry: number,
) {
  if (active) endDrag(active, false);
  const rect = offsetRect(source);
  const ghost = source.cloneNode(true) as HTMLElement;
  for (const el of [ghost, ...ghost.querySelectorAll('[id]')]) el.removeAttribute('id');
  for (const name of ['data-slot-id', 'data-filled', 'aria-label', 'aria-describedby', 'aria-pressed', 'aria-haspopup'])
    ghost.removeAttribute(name);
  ghost.classList.remove('pocket-wiggle');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.pocketGhost = '';
  if (carry > 1) ghost.dataset.carry = String(carry);
  Object.assign(ghost.style, { width: `${rect.width}px`, height: `${rect.height}px` });
  document.body.append(ghost);
  source.dataset.dragSource = '';
  if (carry > 1)
    for (const other of document.querySelectorAll<HTMLElement>('button[data-slot-id][aria-pressed="true"]'))
      if (other !== source) other.dataset.carried = '';

  const seen = new WeakSet<Event>();
  const handled = (event: Event) => {
    if (seen.has(event)) return true;
    seen.add(event);
    return false;
  };
  const d: ActiveDrag = {
    id,
    pointerId,
    source,
    ghost,
    stage: source.closest<HTMLElement>('[data-page-turn-ms]'),
    grabX: origin.x - rect.left,
    grabY: origin.y - rect.top,
    x: origin.x,
    y: origin.y,
    carry,
    onDrag,
    over: null,
    mode: 'place',
    pushed: [],
    hold: null,
    edge: null,
    refresh: null,
    swipe: null,
    detach: () => {},
  };
  // Events come to the pocket and the window both: once the page turns, the pocket is gone from the document and a
  // touch keeps sending its events to it alone (they no longer bubble), so listening there too keeps the drag alive.
  const onMove = (event: PointerEvent) => {
    if (handled(event)) return;
    if (event.pointerId === d.pointerId) return track(d, event.clientX, event.clientY);
    const swipe = d.swipe;
    if (!swipe || swipe.id !== event.pointerId || swipe.done) return;
    const dx = event.clientX - swipe.x,
      dy = event.clientY - swipe.y;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.25) {
      swipe.done = true;
      turnPage(d, dx < 0 ? 1 : -1);
    }
  };
  // A second finger swiping sideways turns the page under the held card.
  const onDown = (event: PointerEvent) => {
    if (event.pointerId !== d.pointerId && event.pointerType === 'touch')
      d.swipe = { id: event.pointerId, x: event.clientX, y: event.clientY, done: false };
  };
  const onUp = (event: PointerEvent) => {
    if (handled(event)) return;
    if (event.pointerId === d.pointerId) endDrag(d, event.type === 'pointerup');
    else if (d.swipe?.id === event.pointerId) d.swipe = null;
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    endDrag(d, false);
  };
  const onLeave = () => endDrag(d, false);
  const onHidden = () => {
    if (document.hidden) endDrag(d, false);
  };
  // The held finger must not scroll or swipe anything else.
  const onTouchMove = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
    if (event.currentTarget === source) event.stopPropagation();
  };
  const targets: EventTarget[] = [window, source];
  for (const target of targets) {
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', onUp as EventListener);
    target.addEventListener('pointercancel', onUp as EventListener);
    // eslint-disable-next-line react-doctor/client-passive-event-listeners -- it has to stop the held finger panning
    target.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
  }
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('blur', onLeave);
  document.addEventListener('visibilitychange', onHidden);
  d.detach = () => {
    for (const target of targets) {
      target.removeEventListener('pointermove', onMove as EventListener);
      target.removeEventListener('pointerup', onUp as EventListener);
      target.removeEventListener('pointercancel', onUp as EventListener);
      target.removeEventListener('touchmove', onTouchMove as EventListener);
    }
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onLeave);
    document.removeEventListener('visibilitychange', onHidden);
  };
  active = d;
  buzz(10);
  if (!reducedMotion()) ghost.animate([{ scale: '1' }, { scale: '1.06' }], { duration: 160, easing: SHIFT_EASE });
  onDrag.start(id);
  track(d, origin.x, origin.y);
}

/**
 * Picking a pocket up. A mouse drags as soon as it moves; a finger after the long press, or after a short rest
 * while the binder wiggles. Once picked up, the card is the controller's (see ActiveDrag); this hook also slides
 * pockets into their new places when a render moves them (FLIP).
 */
function usePocketDrag(id: string, onDrag: PocketDrag | undefined, editing: boolean, carry: number) {
  const ref = useRef<HTMLButtonElement>(null);
  const origin = useRef({ x: 0, y: 0 });
  // Armed: the next move past the tolerance picks the pocket up instead of panning or cancelling.
  const armed = useRef(false);
  const arm = useRef<Timer | null>(null);
  // A finished touch drag still has its touchend to come; the binder's page swipe must not see it.
  const dragged = useRef(false);
  // Where it sat in the grid last render (offsets ignore transforms).
  const place = useRef<{ x: number; y: number; editing: boolean } | null>(null);
  const sliding = useRef<Animation | null>(null);
  // Slide from where it is drawn now, offset by (dx, dy) of grid movement, back to its own place.
  const settle = (dx: number, dy: number) => {
    const el = ref.current;
    if (!el) return;
    const [x, y] = drawnOffset(el);
    el.style.translate = '';
    delete el.dataset.shifting;
    delete el.dataset.pushOut;
    sliding.current?.cancel();
    sliding.current = null;
    const fromX = x + dx,
      fromY = y + dy;
    if ((!fromX && !fromY) || reducedMotion()) return;
    sliding.current = el.animate([{ translate: `${fromX}px ${fromY}px` }, { translate: '0px 0px' }], {
      duration: SHIFT_MS,
      easing: SHIFT_EASE,
    });
  };
  // FLIP: after a render moves this pocket (a drop, an insert, a removal), slide it from where it was drawn. The
  // dropped card itself was already flown into place by the ghost, so it just appears there.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const was = place.current;
    const now = { x: el.offsetLeft, y: el.offsetTop, editing };
    place.current = now;
    const landed = landing.get(id);
    if (landed && (!was || was.x !== now.x || was.y !== now.y)) {
      el.style.translate = '';
      landed();
      return;
    }
    if (!was) return;
    const dx = was.x - now.x,
      dy = was.y - now.y;
    if ((dx || dy) && ((was.editing && now.editing) || el.style.translate)) settle(dx, dy);
  });
  useEffect(
    () => () => {
      if (arm.current) clearTimeout(arm.current);
    },
    [],
  );
  const draggable = Boolean(onDrag);
  useEffect(() => {
    const el = ref.current;
    if (!el || !draggable) return;
    // Touch scrolling and the page swipe listen to touch events, so a held pocket keeps them to itself.
    const onTouchMove = (event: TouchEvent) => {
      if (armed.current && event.cancelable) event.preventDefault();
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
  const capture = (event: ReactPointerEvent<HTMLButtonElement>) => {
    try {
      ref.current?.setPointerCapture(event.pointerId);
    } catch {
      /* Not an active pointer (a synthetic event); touch is captured implicitly anyway. */
    }
  };
  const disarm = () => {
    if (arm.current) {
      clearTimeout(arm.current);
      arm.current = null;
    }
  };
  const dragging = () => active !== null && active.source === ref.current;
  return {
    ref,
    disarm,
    up: () => {
      disarm();
      armed.current = false;
    },
    /** The long press opened the menu: from here, moving the finger picks the pocket up. */
    holdArms: () => {
      armed.current = draggable;
    },
    down: (event: ReactPointerEvent<HTMLButtonElement>, wiggling: boolean) => {
      origin.current = { x: event.clientX, y: event.clientY };
      dragged.current = false;
      disarm();
      armed.current = Boolean(onDrag && event.pointerType === 'mouse' && event.button === 0);
      // A quick flick can leave the pocket before it counts as a drag; captured, its moves still come here.
      if (armed.current) capture(event);
      if (onDrag && wiggling && event.pointerType !== 'mouse')
        arm.current = setTimeout(() => {
          arm.current = null;
          armed.current = true;
        }, WIGGLE_PRESS_MS);
    },
    /** 'dragging' while it is held, 'picked' the moment it lifts, otherwise null. */
    move: (event: ReactPointerEvent<HTMLButtonElement>): 'dragging' | 'picked' | null => {
      if (dragging()) return 'dragging';
      const el = ref.current;
      const moved = Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > MOVE_TOLERANCE_PX;
      if (!el || !onDrag || !armed.current || !moved || (event.pointerType === 'mouse' && event.buttons !== 1))
        return null;
      disarm();
      armed.current = false;
      dragged.current = true;
      sliding.current?.cancel();
      sliding.current = null;
      el.style.translate = '';
      capture(event);
      pickUp(el, id, event.pointerId, origin.current, onDrag, carry);
      return 'picked';
    },
    dragging,
  };
}

/** The inline translate a pocket is drawn at (a gap preview), in px. */
function drawnOffset(el: HTMLElement): [number, number] {
  const [x = '0', y = '0'] = el.style.translate.split(' ');
  return [parseFloat(x) || 0, parseFloat(y) || 0];
}

/** A cell's box without the translate it is drawn at. */
function offsetRect(cell: Element) {
  const box = cell.getBoundingClientRect();
  if (!(cell instanceof HTMLElement)) return box;
  const [x, y] = drawnOffset(cell);
  return new DOMRect(box.left - x, box.top - y, box.width, box.height);
}

/** Arrow-key neighbour in a grid of siblings: one along, or one row up or down (rows read from their offsets). */
function gridNeighbour(el: HTMLElement, key: string) {
  const cells = [...(el.parentElement?.children ?? [])] as HTMLElement[];
  const i = cells.indexOf(el);
  const cols = cells.filter((c) => c.offsetTop === cells[0]?.offsetTop).length || 1;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
  const next = step === undefined ? undefined : cells[i + step];
  return next?.matches('button[data-slot-id]') ? next : undefined;
}

/**
 * One binder pocket. A tap selects it. Where the host offers pocket actions (`onMenu`), a right-click, the keyboard
 * menu key or a long press opens them instead; a long press is dropped as soon as the finger pans, scrolls or
 * turns the page, and never also counts as a tap. `marked` shows layout selection on the pocket itself.
 *
 * Where the host offers `onDrag`, a pocket can be picked up and dropped on another: a mouse drags straight away, a
 * finger keeps holding after the long press (or, while the binder wiggles, rests briefly) and then moves. A quick
 * drop swaps the two; resting on a filled pocket first makes room there; resting at the binder's side, or swiping
 * with a second finger, turns the page under the card; Escape puts it back. While the binder wiggles a resting
 * finger never opens the menu. Arrow keys move focus between pockets, and while editing, Alt with an arrow swaps the
 * focused pocket with its neighbour.
 */
export function OrderedSlot({
  slot,
  slotLabel,
  selected,
  onSelect,
  onMenu,
  onDrag,
  carry,
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
  /** How many pockets are selected; dragging a selected one carries them all. */
  carry?: number;
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
  // A finger is down on this pocket (an Android long press sends contextmenu while it is).
  const touching = useRef(false);
  const wiggling = marked !== undefined;
  const pocketDrag = usePocketDrag(slot.id, onDrag, marked !== undefined, marked ? (carry ?? 1) : 1);
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
      data-filled={slot.item ? '' : undefined}
      aria-label={displaySlotLabel(slot)}
      aria-describedby={slotLabel ? coordinateId : undefined}
      aria-pressed={marked ?? selected}
      draggable={false}
      aria-haspopup={onMenu ? 'menu' : undefined}
      onPointerDown={(event) => {
        // Another finger turning the page under a held card, not a tap on this pocket.
        if (active) return;
        press.current = { key: interactionKey, x: event.clientX, y: event.clientY };
        held.current = false;
        touching.current = event.pointerType !== 'mouse';
        cancelHold();
        pocketDrag.down(event, wiggling);
        // While the binder wiggles a resting finger picks the pocket up; the menu is a right-click away.
        if (!onMenu || event.pointerType === 'mouse' || wiggling) return;
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
        touching.current = false;
        cancelHold();
        pocketDrag.up();
      }}
      onPointerLeave={() => {
        if (!pocketDrag.dragging()) cancelHold();
      }}
      onPointerCancel={() => {
        touching.current = false;
        press.current = null;
        cancelHold();
        pocketDrag.up();
      }}
      onKeyDown={(event) => {
        // Arrows walk the page's pockets; while editing, Alt (Option) with an arrow moves this pocket there instead.
        const next = gridNeighbour(event.currentTarget, event.key);
        if (!next || event.metaKey || event.ctrlKey) return;
        event.preventDefault();
        if (!event.altKey) next.focus();
        else if (onDrag && wiggling && next.dataset.slotId) onDrag.drop(slot.id, next.dataset.slotId, 'place');
      }}
      onContextMenu={(event) => {
        if (!onMenu) return;
        event.preventDefault();
        cancelHold();
        // A touch long press may already have opened the menu; the platform's own event then only needs suppressing.
        // While the binder wiggles, a resting finger is about to drag, not asking for the menu.
        if (held.current || (wiggling && touching.current) || active) return;
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
          !held.current &&
          !active &&
          (event.detail === 0 || (press.current !== null && press.current.key === interactionKey));
        press.current = null;
        held.current = false;
        if (allowed) onSelect(slot.id);
      }}
      className={`relative h-full min-h-9 w-full min-w-9 overflow-hidden text-white select-none [-webkit-touch-callout:none] active:scale-[0.98] ${hasCardImage ? 'bg-transparent' : 'border border-white/25 bg-white/10 shadow-inner'} ${marked || (marked === undefined && selected) ? 'border-primary ring-primary ring-2' : hasCardImage ? 'ring-1 ring-black/5 dark:ring-white/6' : ''} ${dimmed ? 'opacity-45' : ''} ${wiggling ? 'pocket-wiggle' : ''}`}
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
          className={`absolute top-1 right-1 z-10 flex h-5 w-5 items-center justify-center rounded-full border-2 shadow-sm ${marked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/85 bg-black/35'}`}
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
