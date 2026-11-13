/**
 * While a sheet or dialog locks page scroll, iOS still lets a touch on the backdrop, a
 * header or any other non-scrolling part pan (and rubber-band) the page behind it.
 * This guard cancels such touchmoves unless something under the finger can actually
 * scroll in that direction. Installed/removed by the overlay scroll lock.
 */

export interface ScrollBox {
  overflowX: string;
  overflowY: string;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

const SCROLLABLE = /^(auto|scroll|overlay)$/;

/** Whether a box can scroll along the axis the finger is mostly moving on. */
export function canScrollAlong(box: ScrollBox, dx: number, dy: number) {
  if (Math.abs(dy) >= Math.abs(dx)) return SCROLLABLE.test(box.overflowY) && box.scrollHeight > box.clientHeight + 1;
  return SCROLLABLE.test(box.overflowX) && box.scrollWidth > box.clientWidth + 1;
}

function allowsNativeGesture(element: Element) {
  return element.matches(
    "input[type=range], textarea, [contenteditable=''], [contenteditable='true'], [data-allow-touch-scroll]",
  );
}

let installed = false;
let startX = 0;
let startY = 0;
let allowX = false;
let allowY = false;

function onTouchStart(event: TouchEvent) {
  const touch = event.touches[0];
  if (!touch) return;
  startX = touch.clientX;
  startY = touch.clientY;
  allowX = false;
  allowY = false;
  // Resolve both axes once per gesture, never force style/layout during touchmove.
  let node = event.target instanceof Element ? event.target : null;
  while (node && node !== document.body && node !== document.documentElement) {
    if (allowsNativeGesture(node)) {
      allowX = true;
      allowY = true;
      return;
    }
    if (node instanceof HTMLElement) {
      const box = {
        ...pickOverflow(getComputedStyle(node)),
        scrollWidth: node.scrollWidth,
        clientWidth: node.clientWidth,
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
      };
      allowX ||= canScrollAlong(box, 1, 0);
      allowY ||= canScrollAlong(box, 0, 1);
      if (allowX && allowY) return;
    }
    node = node.parentElement;
  }
}

function onTouchMove(event: TouchEvent) {
  // Leave pinch-zoom alone.
  if (event.touches.length !== 1 || !event.cancelable) return;
  const touch = event.touches[0];
  const dx = touch.clientX - startX;
  const dy = touch.clientY - startY;
  if (Math.abs(dy) >= Math.abs(dx) ? allowY : allowX) return;
  event.preventDefault();
}

function pickOverflow(style: CSSStyleDeclaration) {
  return { overflowX: style.overflowX, overflowY: style.overflowY };
}

export function installTouchScrollGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.documentElement.dataset.scrollLocked = '';
  document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  // oxlint-disable-next-line react-doctor/client-passive-event-listeners -- the guard calls preventDefault to stop the page scrolling
  document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
}

export function removeTouchScrollGuard() {
  if (!installed || typeof document === 'undefined') return;
  installed = false;
  delete document.documentElement.dataset.scrollLocked;
  document.removeEventListener('touchstart', onTouchStart, { capture: true });
  document.removeEventListener('touchmove', onTouchMove, { capture: true });
}
