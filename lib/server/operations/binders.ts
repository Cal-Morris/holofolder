import { expirePublicBinders } from '@/lib/server/public-binder-cache';
import { createHash, randomUUID } from 'node:crypto';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner';
import { ensureDefaultBinderId, listOwnerBinders } from '@/lib/server/binders';
import { isBinderId, normalizeBinderName, type Binder } from '@/lib/binders/model';
import { normalizeBinderCardLanguages } from '@/lib/card-languages';
import { isMissingColumnError } from '@/lib/settings';
import { canCreateBinder, validateBinderOrder } from '@/lib/binders/manage';
import { BillingAccessError, canCreateOwnerBinder, isBillingError } from '@/lib/billing';
import { billingErrorResponse, getBillingAccess } from '@/lib/server/billing';

/**
 * Binders of the signed-in owner. A partner manages the owner's binders (they share every binder), so every
 * request resolves the owner first and then uses the service role.
 */
async function requireOwner(user: Pick<User, 'id'>, verifiedOwnerId?: string) {
  const admin = createAdminClient();
  const ownerUserId = verifiedOwnerId ?? (await resolveCollectionOwnerUserId(admin, user.id));
  return { admin, ownerUserId };
}

type Admin = ReturnType<typeof createAdminClient>;

async function listWithCounts(admin: Admin, ownerUserId: string) {
  const [initialBinders, countsResult] = await Promise.all([
    listOwnerBinders(admin, ownerUserId),
    admin.rpc('get_binder_slot_counts', { owner_id: ownerUserId }),
  ]);
  let binders = initialBinders;
  if (binders.length === 0 && (await ensureDefaultBinderId(admin, ownerUserId))) {
    binders = await listOwnerBinders(admin, ownerUserId);
  }
  if (countsResult.error) throw countsResult.error;
  const counts = new Map<string, number>(
    (countsResult.data ?? []).map((row: { binder_id: string; slot_count: number }) => {
      const count = Number(row.slot_count);
      if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid binder slot count');
      return [row.binder_id, count];
    }),
  );
  return binders.map((binder) => ({ ...binder, slotCount: counts.get(binder.id) ?? 0 }));
}

function respond(binders: Array<Binder & { slotCount: number }>, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ binders, ...extra }, { headers: { 'Cache-Control': 'no-store' } });
}

function failure(label: string, error: unknown) {
  console.error(`[holofolder] Failed to ${label}:`, error);
  return NextResponse.json({ error: `Failed to ${label}` }, { status: 500 });
}

export async function listBinders(actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const session = await requireOwner(actor, verifiedOwnerId);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    return respond(await listWithCounts(session.admin, session.ownerUserId));
  } catch (error) {
    return failure('list binders', error);
  }
}

export async function createBinder(request: NextRequest, actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const session = await requireOwner(actor, verifiedOwnerId);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = normalizeBinderName(body?.name);
    if (!name) return NextResponse.json({ error: 'Give the binder a name (up to 40 characters)' }, { status: 400 });

    const { admin, ownerUserId } = session;
    const headerKey = request.headers.get('idempotency-key');
    // Idempotent creates (every developer call) leave both limits to SQL: developer_create_binder's safety limit and the enforce_binder_billing trigger.
    if (!headerKey) {
      const [binders, access] = await Promise.all([
        listOwnerBinders(admin, ownerUserId),
        getBillingAccess(ownerUserId),
      ]);
      if (!canCreateBinder(binders))
        return NextResponse.json({ error: 'You have the most binders allowed' }, { status: 409 });
      if (!canCreateOwnerBinder(access, binders.length)) throw new BillingAccessError('binder_limit_reached');
    }
    // One SQL path creates the binder and its native slots state together.
    const { data, error } = await admin.rpc('developer_create_binder', {
      actor: actor.id,
      owner_id: ownerUserId,
      binder_name: name,
      retry_key: headerKey ?? randomUUID(),
      digest: createHash('sha256').update(JSON.stringify({ ownerUserId, name })).digest('hex'),
    });
    if (error?.message?.includes('idempotency_conflict'))
      return NextResponse.json({ error: 'This idempotency key was used with another request.' }, { status: 409 });
    if (isBillingError(error)) throw new BillingAccessError('binder_limit_reached');
    if (error?.message?.includes('binder_safety_limit_reached'))
      return NextResponse.json({ error: 'You have the most binders allowed' }, { status: 409 });
    if (error) throw error;
    return respond(await listWithCounts(admin, ownerUserId), { createdBinderId: data.id });
  } catch (error) {
    if (isBillingError(error)) return billingErrorResponse(error);
    return failure('create the binder', error);
  }
}

export async function updateBinder(request: NextRequest, actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const session = await requireOwner(actor, verifiedOwnerId);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { admin, ownerUserId } = session;
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      name?: unknown;
      order?: unknown;
      cardLanguages?: unknown;
    } | null;
    const binders = await listOwnerBinders(admin, ownerUserId);

    if (body?.order !== undefined) {
      const order = validateBinderOrder(binders, body.order);
      if (!order) return NextResponse.json({ error: 'The order must list every binder once' }, { status: 400 });
      const result = await admin.rpc('developer_reorder_binders', {
        actor: actor.id,
        owner_id: ownerUserId,
        binder_order: order,
      });
      if (result.error) throw result.error;
      return respond(await listWithCounts(admin, ownerUserId));
    }

    if (!isBinderId(body?.id) || !binders.some((binder) => binder.id === body.id)) {
      return NextResponse.json({ error: 'Binder not found' }, { status: 404 });
    }
    const update: { name?: string; card_languages?: string[] } = {};
    if (body.name !== undefined || body.cardLanguages === undefined) {
      const name = normalizeBinderName(body.name);
      if (!name) return NextResponse.json({ error: 'Give the binder a name (up to 40 characters)' }, { status: 400 });
      update.name = name;
    }
    if (body.cardLanguages !== undefined) {
      const cardLanguages = normalizeBinderCardLanguages(body.cardLanguages);
      if (!cardLanguages) return NextResponse.json({ error: 'Choose at least one card language' }, { status: 400 });
      update.card_languages = cardLanguages;
    }
    const { error } = await admin.from('binders').update(update).eq('id', body.id).eq('owner_user_id', ownerUserId);
    if (error && isMissingColumnError(error))
      return NextResponse.json({ error: 'Card languages are not available yet' }, { status: 503 });
    if (error) throw error;
    expirePublicBinders(ownerUserId);
    return respond(await listWithCounts(admin, ownerUserId));
  } catch (error) {
    return failure('update the binder', error);
  }
}

export async function deleteBinder(request: NextRequest, actor: Pick<User, 'id'>, verifiedOwnerId?: string) {
  try {
    const session = await requireOwner(actor, verifiedOwnerId);
    if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    const { admin, ownerUserId } = session;
    const params = new URL(request.url).searchParams;
    const binderId = params.get('id');
    if (!isBinderId(binderId)) return NextResponse.json({ error: 'Binder not found' }, { status: 404 });
    const { data: plan, error } = await admin.rpc('developer_delete_binder', {
      actor: actor.id,
      owner_id: ownerUserId,
      binder_id_input: binderId,
      confirm_populated: params.get('confirm') === '1',
    });
    if (error) throw error;
    if (!plan?.ok) {
      const reason = plan?.reason ?? 'not-found';
      const message =
        reason === 'last-binder'
          ? "You can't delete your only binder"
          : reason === 'needs-confirmation'
            ? 'This binder has cards; confirm to delete them too'
            : 'Binder not found';
      return NextResponse.json(
        { error: message, reason, slotCount: plan?.slotCount ?? 0 },
        { status: reason === 'not-found' ? 404 : 409 },
      );
    }

    expirePublicBinders(ownerUserId);
    return respond(await listWithCounts(admin, ownerUserId), { deletedBinderId: binderId });
  } catch (error) {
    return failure('delete the binder', error);
  }
}
