import { sendGAEvent } from '@next/third-parties/google';
import type { SlotOfflineIntent } from '@/lib/collection/slot-optimistic';

export type CollectionEvent =
  | 'binder_created'
  | 'binder_deleted'
  | 'card_added'
  | 'card_removed'
  | 'card_moved'
  | 'card_placed'
  | 'card_edited'
  | 'card_unplaced'
  | 'slots_added'
  | 'slots_moved'
  | 'slots_removed'
  | 'slot_updated'
  | 'wanted_updated';

export interface GoogleEvents extends Record<CollectionEvent, { count: number }> {
  screen_view: {
    screen_name: 'binder' | 'list' | 'wanted' | 'sets' | 'pokemon' | 'analytics';
    show_mode: boolean;
    read_only: boolean;
  };
  search_opened: { surface: 'search' | 'quick_mode' | 'price_lookup' };
  price_check_viewed: Record<string, never>;
  binder_opened: { read_only: boolean };
  search: { search_term: string; result_count: number; offline: boolean };
  card_scanned: { outcome: 'match' | 'suggest' | 'choose' | 'unread'; offline: boolean };
  show_mode_toggled: { on: boolean };
  show_purchase_logged: { count: number };
  share_link_copied: { surface: 'binder' | 'settings' };
  want_list_shared: { method: 'share_sheet' | 'clipboard' };
  sign_up_prompted: Record<string, never>;
}

// Set by GoogleAnalyticsProvider so plain lib code (the storage command sender) can track too.
let globallyEnabled = false;
export function setGoogleAnalyticsEnabled(enabled: boolean) {
  globallyEnabled = enabled;
}

/** Fire-and-forget: never throws, never awaited, so analytics can't block or break an operation. */
export function sendGoogleEvent<K extends keyof GoogleEvents>(enabled: boolean, name: K, parameters: GoogleEvents[K]) {
  if (!enabled || typeof window === 'undefined' || !navigator.onLine) return;
  try {
    // Effects can run before Next's inline initialization script.
    const browser = window as Window & { dataLayer?: unknown[] };
    browser.dataLayer ??= [];
    sendGAEvent('event', name, parameters);
  } catch {
    /* Analytics is best effort. */
  }
}

export function trackGoogleEvent<K extends keyof GoogleEvents>(name: K, parameters: GoogleEvents[K]) {
  sendGoogleEvent(globallyEnabled, name, parameters);
}

const inventoryEvents: Record<string, CollectionEvent> = {
  add: 'card_added',
  removeOwned: 'card_removed',
  move: 'card_moved',
  assign: 'card_placed',
  insertAssign: 'card_placed',
  edit: 'card_edited',
  patchGrading: 'card_edited',
  setFinish: 'card_edited',
  unassign: 'card_unplaced',
  removeSlots: 'slots_removed',
  deleteCollection: 'binder_deleted',
};
const slotEvents: Record<string, CollectionEvent> = {
  create: 'slots_added',
  move: 'slots_moved',
  clear: 'slots_removed',
  remove: 'slots_removed',
};

/** One event per command kind in a confirmed storage command, with how many commands of that kind it held. */
export function collectionEvents(intent: SlotOfflineIntent): Map<CollectionEvent, number> {
  const counts = new Map<CollectionEvent, number>();
  const bump = (event: CollectionEvent | undefined) => event && counts.set(event, (counts.get(event) ?? 0) + 1);
  if (intent.kind === 'creation') bump('binder_created');
  else if (intent.kind === 'inventory') for (const c of intent.request.commands) bump(inventoryEvents[c.kind]);
  else if (intent.kind === 'slots')
    for (const c of intent.request.commands)
      bump(
        c.kind === 'update' ? (c.wantedCards !== undefined ? 'wanted_updated' : 'slot_updated') : slotEvents[c.kind],
      );
  return counts;
}

export function trackCollectionCommand(intent: SlotOfflineIntent) {
  for (const [event, count] of collectionEvents(intent)) trackGoogleEvent(event, { count });
}
