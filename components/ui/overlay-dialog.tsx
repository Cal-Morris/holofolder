'use client';

import { useEffect, useLayoutEffect, useRef, type ComponentProps, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { cn } from '@/lib/utils';

const VARIANT_CLASSES = {
  sheet:
    'inset-x-0 top-auto bottom-0 mx-auto w-full max-w-md max-h-[85dvh] rounded-t-[1.6rem] border-t shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border',
  centred:
    'inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2rem)] rounded-[1.6rem] border shadow-[0_24px_64px_-32px_rgba(15,23,42,0.45)]',
} as const;

export type OverlayDialogVariant = keyof typeof VARIANT_CLASSES;

interface OverlayDialogProps extends Omit<ComponentProps<'dialog'>, 'open' | 'onClose' | 'onCancel' | 'ref' | 'role'> {
  /** Called once for every way of closing: X (yours), backdrop, Escape, back, swipe, dock switch. */
  onClose: () => void;
  /** `sheet` sits on the bottom edge and swipes down to dismiss; `centred` floats mid-screen. */
  variant?: OverlayDialogVariant;
  /** Focus the dialog itself when it opens (default true). Pass false when a field focuses itself. */
  autoFocus?: boolean;
}

function isOutside(element: Element, x: number, y: number) {
  const rect = element.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * The shared overlay: a native `<dialog>` opened with `showModal()`, so it renders in the top layer
 * (above the header and dock), makes the page behind it inert and returns focus natively. Render it
 * while open and unmount it to close. `useOverlay` still owns Escape, back, the stack
 * (`closeAllOverlays`), the scroll lock and the Tab trap, so it stacks with the older div overlays.
 *
 * - Backdrop: `::backdrop` dims the page; a press and click both outside the dialog close it.
 * - Swipe (sheet): mark the header `data-sheet-grabber`; the body pulls down from the top on touch.
 * - Name it with `aria-label` or `aria-labelledby`, and render your own X (36 px+) calling `onClose`.
 * - The dialog is the panel: pass padding, height, layout and colours through `className`.
 */
export function OverlayDialog({
  onClose,
  variant = 'sheet',
  autoFocus = true,
  className,
  children,
  ...props
}: OverlayDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  const pressedBackdropRef = useRef(false);
  const escapeKeyRef = useRef(false);
  const closedRef = useRef(false);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useOverlay(true, onClose, { containerRef: dialogRef, autoFocus: false });
  const swipe = useSwipeToDismiss(dialogRef, onClose, variant === 'sheet');

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closedRef.current = false;
    if (!dialog.open) dialog.showModal();
    if (autoFocus) dialog.focus({ preventScroll: true });
    // Unmounting is the close: ignore a native `close` the removal may queue.
    return () => {
      closedRef.current = true;
    };
  }, [autoFocus]);

  // useOverlay handles Escape on keydown (and swallows it when it closes). When it lets one through on purpose
  // (an input clearing itself), the dialog still turns it into `cancel`; remember it so `cancel` ignores it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      escapeKeyRef.current = true;
      window.setTimeout(() => {
        escapeKeyRef.current = false;
      }, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const requestClose = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    const dialog = event.currentTarget;
    pressedBackdropRef.current = event.target === dialog && isOutside(dialog, event.clientX, event.clientY);
    if (!pressedBackdropRef.current && event.target instanceof Element && event.target.closest('[data-sheet-grabber]'))
      swipe.onPointerDown(event);
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    const dialog = event.currentTarget;
    const backdrop = event.target === dialog && isOutside(dialog, event.clientX, event.clientY);
    // A long press that opened the dialog lifts onto the backdrop: only a press that began there closes it.
    if (backdrop && pressedBackdropRef.current) onCloseRef.current();
    pressedBackdropRef.current = false;
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the click is the backdrop tap; Escape is its keyboard path
    <dialog
      {...props}
      ref={dialogRef}
      // Explicit so `[role=dialog]` selectors (overscroll CSS, e2e) keep matching.
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles
      role="dialog"
      tabIndex={-1}
      className={cn(
        'border-border/65 bg-card text-foreground fixed max-w-none overflow-visible outline-none backdrop:bg-black/45 backdrop:backdrop-blur-[2px] [&_[data-sheet-grabber]]:touch-none',
        VARIANT_CLASSES[variant],
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onClick={handleClick}
      onCancel={(event) => {
        // Escape is useOverlay's; any other close request (Android back via CloseWatcher) closes it here.
        event.preventDefault();
        if (!escapeKeyRef.current) requestClose();
      }}
      // The browser may still close it (a repeated request without user activation): keep React in step.
      onClose={requestClose}
    >
      {children}
    </dialog>,
    document.body,
  );
}
