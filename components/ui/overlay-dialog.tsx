'use client';

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useOverlay, useSwipeToDismiss } from '@/hooks/use-overlay';
import { cn } from '@/lib/utils';

const VARIANT_CLASSES = {
  sheet:
    'inset-x-0 top-auto bottom-0 mx-auto w-full max-w-md max-h-[85dvh] rounded-t-[1.6rem] border-t shadow-[0_-24px_64px_-32px_rgba(15,23,42,0.35)] sm:bottom-4 sm:rounded-[1.6rem] sm:border',
  centred:
    'inset-0 m-auto h-fit w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-2rem)] rounded-[1.6rem] border shadow-[0_24px_64px_-32px_rgba(15,23,42,0.45)]',
} as const;

const MODAL_CLASSES =
  'border-border/65 bg-card text-foreground fixed max-w-none overflow-visible outline-none backdrop:bg-black/45 backdrop:backdrop-blur-[2px]';
// A non-modal dialog is laid out like the div it replaces: undo the UA dialog box (fit-content size, inline insets,
// Canvas colours) and leave position, size and colours to the caller.
const NON_MODAL_CLASSES = 'fixed left-auto right-auto h-auto w-auto bg-transparent text-inherit outline-none';

export type OverlayDialogVariant = keyof typeof VARIANT_CLASSES;

interface OverlayDialogProps extends Omit<ComponentProps<'dialog'>, 'open' | 'onClose' | 'onCancel' | 'ref' | 'role'> {
  /** Called once for every way of closing: X (yours), backdrop, Escape, back, swipe, dock switch. */
  onClose: () => void;
  /** `sheet` swipes down to dismiss (and, modal, sits on the bottom edge); `centred` floats mid-screen. */
  variant?: OverlayDialogVariant;
  /** Focus the dialog itself when it opens (default true). Pass false when a field focuses itself. */
  autoFocus?: boolean;
  /**
   * `true` (default): `showModal()`, top layer above the header and dock, page inert. `false`: `show()`, so it stays
   * in the page's z-index stacking with a `data-overlay-backdrop` div, for overlays that leave the dock (z-45) usable.
   */
  modal?: boolean;
  /** Non-modal: the backdrop div's props; `className` adds to `fixed inset-0` (colour, blur, z-index). */
  backdropProps?: Omit<ComponentProps<'div'>, 'onClick'>;
  /** Non-modal: wrap backdrop and dialog in a `fixed inset-0` layer with these classes (its z-index). */
  layerClassName?: string;
  /** Render into `document.body` (default true). Pass false to keep it where it is in the tree. */
  portal?: boolean;
  ref?: Ref<HTMLDialogElement | null>;
}

function isOutside(element: Element, x: number, y: number) {
  const rect = element.getBoundingClientRect();
  return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom;
}

/**
 * The shared overlay: a native `<dialog>`. Modal by default (`showModal()`), so it renders in the top layer (above
 * the header and dock), makes the page behind it inert and returns focus natively. Render it while open and unmount
 * it to close. `useOverlay` still owns Escape, back, the stack (`closeAllOverlays`), the scroll lock and the Tab trap,
 * so modal and non-modal ones stack with each other and with the older div overlays.
 *
 * - Backdrop: modal, `::backdrop` dims the page and a press and click both outside the dialog close it. Non-modal, a
 *   `data-overlay-backdrop` div (style it with `backdropProps`) closes it.
 * - Swipe (sheet): mark the header `data-sheet-grabber`; the body pulls down from the top on touch.
 * - Name it with `aria-label` or `aria-labelledby`, and render your own X (36 px+) calling `onClose`.
 * - The dialog is the panel: pass padding, height, layout and colours through `className`.
 */
export function OverlayDialog({
  onClose,
  variant = 'sheet',
  autoFocus = true,
  modal = true,
  backdropProps,
  layerClassName,
  portal = true,
  ref,
  className,
  children,
  onClick,
  onPointerDown,
  ...props
}: OverlayDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useImperativeHandle<HTMLDialogElement | null, HTMLDialogElement | null>(ref, () => dialogRef.current, []);
  const onCloseRef = useRef(onClose);
  const pressedBackdropRef = useRef(false);
  const escapeKeyRef = useRef(false);
  const closedRef = useRef(false);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  // show()/showModal() and the focus below move focus before useOverlay's effect looks: hand it the opener.
  const openerRef = useRef<HTMLElement | null>(null);
  useOverlay(true, onClose, { containerRef: dialogRef, autoFocus: false, openerRef });
  const swipe = useSwipeToDismiss(dialogRef, onClose, variant === 'sheet');

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    closedRef.current = false;
    if (!openerRef.current && document.activeElement instanceof HTMLElement) openerRef.current = document.activeElement;
    if (!dialog.open) {
      if (modal) dialog.showModal();
      else dialog.show();
    }
    if (autoFocus) dialog.focus({ preventScroll: true });
    // Unmounting is the close: ignore a native `close` the removal may queue.
    return () => {
      closedRef.current = true;
    };
  }, [autoFocus, modal]);

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
    onPointerDown?.(event);
    const dialog = event.currentTarget;
    pressedBackdropRef.current = event.target === dialog && isOutside(dialog, event.clientX, event.clientY);
    if (!pressedBackdropRef.current && event.target instanceof Element && event.target.closest('[data-sheet-grabber]'))
      swipe.onPointerDown(event);
  };

  const handleClick = (event: MouseEvent<HTMLDialogElement>) => {
    onClick?.(event);
    const dialog = event.currentTarget;
    const backdrop = event.target === dialog && isOutside(dialog, event.clientX, event.clientY);
    // A long press that opened the dialog lifts onto the backdrop: only a press that began there closes it.
    if (backdrop && pressedBackdropRef.current) onCloseRef.current();
    pressedBackdropRef.current = false;
  };

  if (typeof document === 'undefined') return null;

  const dialog = (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- the click is the backdrop tap; Escape is its keyboard path
    <dialog
      // A non-modal dialog is still announced as modal: useOverlay traps focus in it.
      aria-modal={modal ? undefined : true}
      {...props}
      ref={dialogRef}
      // Explicit so `[role=dialog]` selectors (overscroll CSS, e2e) keep matching.
      // oxlint-disable-next-line jsx-a11y/no-redundant-roles
      role="dialog"
      tabIndex={-1}
      className={cn(
        modal ? MODAL_CLASSES : NON_MODAL_CLASSES,
        '[&_[data-sheet-grabber]]:touch-none',
        modal && VARIANT_CLASSES[variant],
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
    </dialog>
  );

  let content = dialog;
  if (!modal) {
    const backdrop = (
      <div
        data-overlay-backdrop
        aria-hidden="true"
        {...backdropProps}
        className={cn(layerClassName === undefined ? 'fixed inset-0' : 'absolute inset-0', backdropProps?.className)}
        onClick={onClose}
      />
    );
    content =
      layerClassName === undefined ? (
        <>
          {backdrop}
          {dialog}
        </>
      ) : (
        <div className={cn('fixed inset-0', layerClassName)}>
          {backdrop}
          {dialog}
        </div>
      );
  }
  return portal ? createPortal(content, document.body) : content;
}

const GRABBER_CLASSES = 'bg-muted-foreground/30 rounded-full';

/**
 * The grabber pill. Block (default) sits above the title; `floating` is pinned to the top centre of a header row.
 * Decorative: put it inside the `data-sheet-grabber` header.
 */
export function OverlayGrabber({ floating = false, className }: { floating?: boolean; className?: string }) {
  return floating ? (
    <span
      aria-hidden="true"
      className={cn(
        GRABBER_CLASSES,
        'pointer-events-none absolute top-1 left-1/2 h-1 w-10 -translate-x-1/2',
        className,
      )}
    />
  ) : (
    <div aria-hidden="true" className={cn(GRABBER_CLASSES, 'mx-auto mb-2 h-1.5 w-10', className)} />
  );
}

/** The overlay's X: a 40 px round button (pass `h-9 w-9` for 36 px). `children` replaces the icon. */
export function OverlayCloseButton({
  label,
  onClick,
  disabled,
  className,
  iconClassName,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  iconClassName?: string;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn('hover:bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-full', className)}
    >
      {children ?? <X className={cn('h-4 w-4', iconClassName)} />}
    </button>
  );
}

/** A bordered header row that drags the sheet: floating grabber, then your title and `OverlayCloseButton`. */
export function OverlayHeader({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <header
      data-sheet-grabber
      className={cn('border-border relative flex shrink-0 items-center justify-between gap-2 border-b p-3', className)}
    >
      <OverlayGrabber floating />
      {children}
    </header>
  );
}

/** The bordered action row at the bottom of a sheet (Cancel, then the primary action). */
export function OverlayFooter({ className, children }: { className?: string; children: ReactNode }) {
  return <footer className={cn('border-border flex shrink-0 gap-2 border-t p-3', className)}>{children}</footer>;
}

/**
 * A small anchored menu (header and toolbar "more" menus): non-modal and rendered in place, with a clear backdrop
 * under the dock and the panel at z-50. `className`/`style` place it; `heading` and an X head the list.
 */
export function OverlayMenu({
  onClose,
  label,
  heading,
  headingClassName = 'text-sm font-semibold',
  closeLabel,
  className,
  style,
  ref,
  children,
}: {
  onClose: () => void;
  label: string;
  heading: string;
  headingClassName?: string;
  closeLabel: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<HTMLDialogElement | null>;
  children: ReactNode;
}) {
  return (
    <OverlayDialog
      ref={ref}
      modal={false}
      portal={false}
      variant="centred"
      onClose={onClose}
      backdropProps={{ className: 'z-40' }}
      aria-label={label}
      style={style}
      className={cn(
        'border-border/60 bg-card z-50 flex flex-col overflow-hidden rounded-2xl border p-1.5 shadow-xl',
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between pl-3">
        <p className={headingClassName}>{heading}</p>
        <OverlayCloseButton label={closeLabel} onClick={onClose} className="h-9 w-9 shrink" />
      </div>
      {children}
    </OverlayDialog>
  );
}
