/**
 * The first-account tour: a few intro slides, then coach marks on the real header and dock. Shown once per new
 * account, after the first-binder wizard. Pure data and decisions; the hook and UI live in
 * `hooks/use-first-account-tour.ts` and `components/first-account-tour.tsx`.
 */

/** Supabase user metadata flag (and this device's copy): `due` once the first-binder wizard opens, `done` after. */
export const TOUR_METADATA = 'holofolder_tour';
/** Settings → Replay tour asks the mounted session to show it again. */
export const REPLAY_TOUR_EVENT = 'holofolder-replay-tour';

export type TourFlag = 'due' | 'done' | null;
export const parseTourFlag = (value: unknown): TourFlag => (value === 'due' || value === 'done' ? value : null);

/**
 * Where the tour stands when a session starts. Synthetic e2e pages skip it unless asked (`?tour=1`); then this
 * device's copy wins over the account's, since it is written first and also holds offline.
 */
export function startingTourFlag({
  harness,
  asked,
  local,
  account,
}: {
  harness: boolean;
  asked: boolean;
  local: TourFlag;
  account: TourFlag;
}): TourFlag {
  if (harness && !asked) return 'done';
  if (local) return local;
  if (harness) return 'due';
  return account;
}

/** The one-time wizard → tour hand-off: a flag already set (either way) stays as it is. */
export const tourFlagAfterWizard = (flag: TourFlag): TourFlag => flag ?? 'due';

export type TourSlideIcon = 'binder' | 'inventory' | 'wanted' | 'search' | 'show';
export interface TourSlide {
  icon: TourSlideIcon;
  title: string;
  body: string;
}
export const TOUR_SLIDES: readonly TourSlide[] = [
  {
    icon: 'binder',
    title: 'Binders, your way',
    body: 'Start a binder from the National Dex, a regional dex or a set, or lay one out yourself. Each pocket shows the card that belongs there.',
  },
  {
    icon: 'inventory',
    title: 'Everything you own',
    body: 'Add cards to pockets as you collect them. Inventory lists every card you own, in a binder or not.',
  },
  {
    icon: 'wanted',
    title: 'Wanted, with prices',
    body: 'Keep a want list of the cards you’re hunting, and see what each one sells for.',
  },
  {
    icon: 'search',
    title: 'Browse, search and scan',
    body: 'Browse every set and Pokémon, search for any card, or scan one with your camera.',
  },
  {
    icon: 'show',
    title: 'Show mode for card shows',
    body: 'At a card show, turn on Show mode to check a price against your want list in a couple of taps.',
  },
];

export interface CoachMark {
  id: string;
  /** CSS selector of the real control it points at; a mark whose control isn't on screen is left out. */
  target: string;
  title: string;
  body: string;
}
export const COACH_MARKS: readonly CoachMark[] = [
  {
    id: 'binders',
    // The header switcher, or the binder picker above a native binder's pages.
    target: '[data-testid="binder-switcher-trigger"], button[aria-label="Collection"][aria-haspopup="dialog"]',
    title: 'Your binders',
    body: 'Switch binders or start a new one here.',
  },
  {
    id: 'show',
    target: '[data-testid="header-show-mode"]',
    title: 'Show mode',
    body: 'Turn it on at a card show to check deals fast.',
  },
  {
    id: 'search',
    target: '[data-dock] [aria-label="Search"]',
    title: 'Search',
    body: 'Find any card or scan one. Press and hold for Quick mode.',
  },
  {
    id: 'inventory',
    target: '[data-dock] [aria-label="Inventory"]',
    title: 'Inventory',
    body: 'Every card you own, in a binder or not.',
  },
  {
    id: 'wanted',
    target: '[data-dock] [aria-label="Wanted"]',
    title: 'Wanted',
    body: 'The cards you’re hunting, with prices.',
  },
  {
    id: 'browse',
    target: '[data-dock] [aria-label="Browse"]',
    title: 'Browse',
    body: 'Explore every set and Pokémon.',
  },
];

/** The marks whose control is on screen now (the dock is phone-only; Show needs cards). */
export const availableCoachMarks = (marks: readonly CoachMark[], isShown: (target: string) => boolean) =>
  marks.filter((mark) => isShown(mark.target));
