import { readBinderStartMarker, writeBinderStartMarker } from '@/lib/binder-start';
import { readBillingCache } from '@/lib/billing-cache';
import { isSlotContractId } from '@/lib/domain/binder-slots';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import type { InventoryReadScope } from '@/lib/collection/inventory-read-transport';
import type { CollectionNavigationRead } from '@/lib/collection-navigation';
import type { AtomicOfflineStore } from '@/lib/offline-store/kv';
import type { Session } from '@supabase/supabase-js';

/** Only the already checked live host calls this. No credentials/session store is created. */
export function rememberNativeStartup(storage: Pick<Storage, 'getItem' | 'setItem'>, scope: InventoryReadScope) {
  const deviceId = storage.getItem('holofolder-slot-device-v1');
  if (!isSlotContractId(deviceId)) return;
  const previous = readBinderStartMarker(storage);
  const same = previous?.userId === scope.actorUserId && previous.ownerUserId === scope.ownerUserId;
  writeBinderStartMarker(storage, {
    userId: scope.actorUserId,
    ownerUserId: scope.ownerUserId,
    binderId: same ? previous.binderId : null,
    binders: same ? previous.binders : [],
    native: { version: 1, deviceId, authSessionId: scope.authSessionId },
  });
}

/** The existing Supabase device session is used only for cached display, never verified remotely here.
 * A JWT payload match is NOT signature verification or current membership evidence. */
export function cachedNativeIdentity(storage: Pick<Storage, 'getItem'>, session: Session | null, now = Date.now()) {
  const marker = readBinderStartMarker(storage),
    native = marker?.native;
  if (
    !session ||
    !marker ||
    !native ||
    marker.userId !== session.user.id ||
    !isSlotContractId(native.deviceId) ||
    storage.getItem('holofolder-slot-device-v1') !== native.deviceId ||
    !session.expires_at ||
    !Number.isFinite(session.expires_at * 1000) ||
    session.expires_at * 1000 <= now
  )
    return null;
  let expiresAt = session.expires_at * 1000;
  try {
    const payload = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(payload));
    if (
      claims.sub !== marker.userId ||
      claims.session_id !== native.authSessionId ||
      typeof claims.exp !== 'number' ||
      !Number.isFinite(claims.exp * 1000) ||
      claims.exp * 1000 <= now
    )
      return null;
    expiresAt = Math.min(expiresAt, claims.exp * 1000);
  } catch {
    return null;
  }
  if (marker.ownerUserId !== marker.userId) {
    // Exact legacy readLocalBinderStart/readOfflineShellState policy, not fresh partnership proof.
    const access = readBillingCache(storage, marker.userId, marker.ownerUserId, now);
    if (!access || (access.enforced && access.tier !== 'paid')) return null;
  }
  return {
    marker,
    expiresAt,
    scope: {
      deviceId: native.deviceId,
      workspaceId: 'holofolder',
      accountId: marker.userId,
      ownerUserId: marker.ownerUserId,
    },
  };
}

/** Cached navigation and local planning from one canonical queue/metadata transaction.
 * This never establishes remote membership, completeness, sending or ACK authority. */
export async function readCachedNativeStartup(
  store: AtomicOfflineStore,
  identity: NonNullable<ReturnType<typeof cachedNativeIdentity>>,
  epoch: string,
): Promise<{
  read: CollectionNavigationRead;
  pending: number;
  planning: Awaited<ReturnType<ReturnType<typeof createSlotOfflineQueue>['readLocalPlanning']>>;
}> {
  const { scope } = identity;
  const queue = createSlotOfflineQueue(store, scope);
  const planning = await queue.readLocalPlanning(identity.marker.native!.authSessionId);
  return {
    read: {
      scope: { accountUserId: scope.accountId!, ownerUserId: scope.ownerUserId!, sessionId: epoch },
      evidence: { kind: 'cached', snapshot: planning.snapshot },
      catalog: planning.catalog,
      layouts: planning.layouts,
    },
    pending: planning.pending,
    planning,
  };
}

/** getSession may try to refresh an expired token on dead Wi-Fi. Bound startup only;
 * this does not cancel/replace Supabase's auth lifecycle or authorize cached identity. */
export async function readDeviceStartupSession(
  getSession: () => Promise<{ data: { session: Session | null } }>,
  timeoutMs = 2000,
): Promise<Session | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getSession().then(({ data }) => data.session),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
