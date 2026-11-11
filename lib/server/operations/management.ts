import { serializeDeveloperAppearance, restoreDeveloperAppearance } from '@/lib/server/developer-appearance';
import { requireArtworkStore } from '@/lib/server/binder-appearance';
import { BINDER_ARTWORK_TYPES, MAX_BINDER_ARTWORK_BYTES, isBinderUploadId } from '@/lib/binder-appearance';
import { randomBytes } from 'node:crypto';
import type { OperationContext } from '@/lib/developer-api/types';
import { DeveloperAccessError } from '@/lib/developer-api/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveWriteBinderId } from '@/lib/server/binders';
import { normalizeUsername, normalizeDisplayName, accountDisplayName } from '@/lib/account-identity';
import { normalizeBinderSlug } from '@/lib/public-binder-identity';
import { readAccountUsername, readBinderIdentity, namedSharePath } from '@/lib/server/public-binder-identity';
import { buildBinderSharePath } from '@/lib/binder-share';
import { parseBinderAppearance, binderArtworkIds } from '@/lib/binder-appearance';
import { readAppearance, writeAppearance, loadBinderArtwork } from '@/lib/server/binder-appearance';
export function managementDatabaseError(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (error.code === '23505')
    throw new DeveloperAccessError('already_taken', 'That name or resource is already in use.', 409);
  if (error.code === '22023' || error.code === '23514')
    throw new DeveloperAccessError('invalid_input', 'Invalid management request.', 400);
  if (error.code === '42501')
    throw new DeveloperAccessError('not_found', 'The requested resource is not available to this account.', 404);
  if (error.message?.includes('upgrade_required'))
    throw new DeveloperAccessError('premium_required', 'Premium access is required.', 402);
  if (/Already partnered|no longer pending|idempotency_conflict/.test(error.message ?? ''))
    throw new DeveloperAccessError(
      'conflict',
      'This request conflicts with the current state. Reload before retrying.',
      409,
    );
  throw new Error('Management operation unavailable');
}
function requireOwner(context: OperationContext) {
  if (context.principal.actorId !== context.ownerUserId)
    throw new DeveloperAccessError('owner_required', 'Only the collection owner can manage public sharing.', 403);
}
export async function readDeveloperIdentity(context: OperationContext) {
  const admin = createAdminClient();
  const [{ data, error }, username] = await Promise.all([
    admin.auth.admin.getUserById(context.principal.actorId),
    readAccountUsername(admin, context.principal.actorId),
  ]);
  if (error || !data.user) throw new Error('Account identity unavailable');
  return { username, displayName: accountDisplayName(data.user.user_metadata) };
}
export async function updateDeveloperIdentity(context: OperationContext, input: Record<string, unknown>) {
  const admin = createAdminClient();
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    if (!username) throw new DeveloperAccessError('invalid_username', 'Use 3 to 30 letters, numbers or hyphens.', 400);
    const { error } = await admin.rpc('developer_claim_identity', {
      actor: context.principal.actorId,
      username,
      binder: null,
      slug: null,
    });
    managementDatabaseError(error);
  }
  if (input.displayName !== undefined) {
    const name = normalizeDisplayName(input.displayName);
    if (!name) throw new DeveloperAccessError('invalid_name', 'Use a display name of up to 60 characters.', 400);
    const current = await admin.auth.admin.getUserById(context.principal.actorId);
    if (current.error || !current.data.user) throw new Error('Account identity unavailable');
    const { error } = await admin.auth.admin.updateUserById(context.principal.actorId, {
      user_metadata: { ...current.data.user.user_metadata, display_name: name, name },
    });
    if (error) throw new Error('Display name update unavailable');
  }
  return readDeveloperIdentity(context);
}
export async function developerBinderIdentity(
  context: OperationContext,
  input: Record<string, unknown>,
  write = false,
) {
  const binder = await resolveWriteBinderId(createAdminClient(), context.ownerUserId, input.binderId);
  if (write) {
    requireOwner(context);
    const slug = normalizeBinderSlug(input.slug);
    if (!slug) throw new DeveloperAccessError('invalid_slug', 'Use a valid binder slug of up to 60 characters.', 400);
    const { error } = await createAdminClient().rpc('developer_claim_identity', {
      actor: context.principal.actorId,
      username: null,
      binder,
      slug,
    });
    managementDatabaseError(error);
  }
  return {
    ...(await readBinderIdentity(context.ownerUserId, binder)),
    canEdit: context.principal.actorId === context.ownerUserId,
  };
}
export async function developerSharing(context: OperationContext, input: Record<string, unknown>, write = false) {
  requireOwner(context);
  const admin = createAdminClient(),
    binder = await resolveWriteBinderId(admin, context.ownerUserId, input.binderId);
  const { data: existing, error } = await admin
    .from('binder_shares')
    .select('token,is_enabled,show_prices,updated_at')
    .eq('owner_user_id', context.ownerUserId)
    .eq('binder_id', binder)
    .maybeSingle();
  managementDatabaseError(error);
  let share = existing;
  if (write) {
    if (input.enabled === true) {
      const result = await admin
        .from('binder_shares')
        .upsert(
          {
            owner_user_id: context.ownerUserId,
            binder_id: binder,
            token: existing?.token ?? randomBytes(24).toString('base64url'),
            is_enabled: true,
            show_prices: input.showPrices ?? existing?.show_prices ?? false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'owner_user_id,binder_id' },
        )
        .select('token,is_enabled,show_prices,updated_at')
        .single();
      managementDatabaseError(result.error);
      share = result.data;
    } else if (existing) {
      const result = await admin
        .from('binder_shares')
        .update({ is_enabled: false, updated_at: new Date().toISOString() })
        .eq('owner_user_id', context.ownerUserId)
        .eq('binder_id', binder)
        .select('token,is_enabled,show_prices,updated_at')
        .single();
      managementDatabaseError(result.error);
      share = result.data;
    }
  }
  return {
    share: share
      ? { ...share, path: (await namedSharePath(context.ownerUserId, binder)) ?? buildBinderSharePath(share.token) }
      : null,
  };
}
export async function developerAppearance(context: OperationContext, input: Record<string, unknown>, write = false) {
  const admin = createAdminClient(),
    owner = context.ownerUserId;
  if (!write) return serializeDeveloperAppearance(await readAppearance(admin, owner));
  let payload;
  try {
    payload = parseBinderAppearance({ ...input, design: restoreDeveloperAppearance(input.design) });
  } catch {
    throw new DeveloperAccessError('invalid_appearance', 'Invalid binder appearance or revision.', 400);
  }
  const current = await readAppearance(admin, owner);
  if (payload.baseRevision !== current.revision)
    throw new DeveloperAccessError('conflict', 'Appearance changed on another device. Reload before retrying.', 409);
  for (const id of binderArtworkIds(payload.design)) await loadBinderArtwork(admin, owner, id);
  const saved = await writeAppearance(admin, owner, payload.design, payload.baseRevision);
  if (!saved)
    throw new DeveloperAccessError('conflict', 'Appearance changed on another device. Reload before retrying.', 409);
  return serializeDeveloperAppearance(saved);
}

export async function developerArtwork(context: OperationContext, input: Record<string, unknown>, upload = false) {
  const admin = createAdminClient(),
    id = typeof input.id === 'string' ? `upload:${input.id}` : input.id;
  if (!isBinderUploadId(id))
    throw new DeveloperAccessError('invalid_artwork', 'Choose a valid artwork identifier.', 400);
  const store = requireArtworkStore();
  if (upload) {
    if (
      !BINDER_ARTWORK_TYPES.includes(input.mimeType as (typeof BINDER_ARTWORK_TYPES)[number]) ||
      typeof input.size !== 'number' ||
      !Number.isSafeInteger(input.size) ||
      input.size <= 0 ||
      input.size > MAX_BINDER_ARTWORK_BYTES
    )
      throw new DeveloperAccessError('invalid_artwork', 'Choose a PNG, JPEG or WebP image under 5 MB.', 400);
    await readAppearance(admin, context.ownerUserId);
    if (await store.exists(context.ownerUserId, id)) return { id: input.id, artworkRef: id, exists: true };
    return {
      id: input.id,
      artworkRef: id,
      ...(await store.prepareUpload(context.ownerUserId, id, String(input.mimeType), input.size as number)),
    };
  }
  if (!(await store.exists(context.ownerUserId, id)))
    throw new DeveloperAccessError('not_found', 'Artwork is not available.', 404);
  return {
    id: input.id,
    artworkRef: id,
    downloadUrl: await store.downloadUrl(context.ownerUserId, id),
    expiresIn: 300,
    storage: 'r2-private',
  };
}
