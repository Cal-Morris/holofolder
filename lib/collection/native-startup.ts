import { readBinderStartMarker, writeBinderStartMarker } from '@/lib/binder-start';
import { readBillingCache } from '@/lib/billing-cache';
import { isSlotContractId } from '@/lib/domain/binder-slots';
import { createSlotOfflineQueue } from '@/lib/collection/slot-offline-queue';
import { parseNavigationEvidence, type InventoryReadScope } from '@/lib/collection/inventory-read-transport';
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

/** Read-only adapter over the one canonical queue and its existing navigation metadata.
 * Admission must be checked by the caller. No saveSnapshot/replay/ACK or completeness branding. */
export async function readCachedNativeStartup(
  store: AtomicOfflineStore,
  identity: NonNullable<ReturnType<typeof cachedNativeIdentity>>,
  epoch: string,
): Promise<{ read: CollectionNavigationRead; pending: number }> {
  const { scope } = identity;
  const record = await createSlotOfflineQueue(store, scope).read();
  if (!record.snapshot || !record.optimistic) throw new Error('native-startup-not-saved');
  const metadata = await store.get(
    `slot-navigation-v1:${JSON.stringify([scope.deviceId, scope.accountId, scope.ownerUserId])}`,
  );
  const parsed = parseNavigationEvidence(metadata, record.snapshot);
  if (!parsed || parsed.layouts.length !== record.snapshot.binders.length)
    throw new Error('native-startup-metadata-unavailable');
  const layouts = parsed.layouts.map((layout) => {
    const projected = record.optimistic!.binders.find((b) => b.collectionId === layout.collectionId);
    if (!projected) throw new Error('native-startup-layout-unavailable');
    return { ...layout, layoutRevision: projected.layoutRevision };
  });
  return {
    read: {
      scope: { accountUserId: scope.accountId!, ownerUserId: scope.ownerUserId!, sessionId: epoch },
      evidence: { kind: 'cached', snapshot: record.optimistic },
      ...parsed,
      layouts,
    },
    pending: record.pending.filter((p) => p.status !== 'acknowledged').length,
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
