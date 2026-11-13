import { expirePublicBinders } from '@/lib/server/public-binder-cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { isBinderId } from '@/lib/binders/model';
import { isMissingIdentitySchema, normalizeBinderSlug } from '@/lib/public-binder-identity';
import { resolveCollectionOwnerUserId } from '@/lib/server/collection-owner';
import {
  IdentityError,
  identityFailure,
  identityJson,
  identitySession,
  readBinderIdentity,
  requireIdentityOrigin,
} from '@/lib/server/public-binder-identity';

export async function GET(request: Request) {
  try {
    const { user } = await identitySession();
    const binderId = new URL(request.url).searchParams.get('binderId');
    if (!isBinderId(binderId)) throw new IdentityError('Binder not found.', 404);
    const admin = createAdminClient();
    const owner = await resolveCollectionOwnerUserId(admin, user.id);
    const { data, error } = await admin
      .from('binders')
      .select('id')
      .eq('id', binderId)
      .eq('owner_user_id', owner)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new IdentityError('Binder not found.', 404);
    try {
      return identityJson({
        ...(await readBinderIdentity(owner, binderId)),
        canEdit: owner === user.id,
        available: true,
      });
    } catch (error) {
      if (isMissingIdentitySchema(error as { code?: string }))
        return identityJson({ username: null, slug: null, canEdit: owner === user.id, available: false });
      throw error;
    }
  } catch (error) {
    return identityFailure(error, 'Binder slug');
  }
}

export async function PATCH(request: Request) {
  try {
    requireIdentityOrigin(request);
    const { client, user } = await identitySession(true);
    const body = await request.json().catch(() => null);
    if (!isBinderId(body?.binderId)) throw new IdentityError('Binder not found.', 404);
    const slug = normalizeBinderSlug(body?.slug);
    if (!slug)
      throw new IdentityError(
        'Use 1–60 letters, numbers or hyphens, starting and ending with a letter or number.',
        400,
      );
    const { error } = await client.rpc('set_binder_public_slug', {
      requested_binder_id: body.binderId,
      requested_slug: slug,
    });
    if (error) throw error;
    expirePublicBinders(user.id, { links: true });
    return identityJson({ ...(await readBinderIdentity(user.id, body.binderId)), canEdit: true, available: true });
  } catch (error) {
    return identityFailure(error, 'Binder slug');
  }
}
