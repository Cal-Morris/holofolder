-- Faster row-level security.
-- Policies that call auth.uid() / auth.jwt() / auth.role() directly re-evaluate the function for every
-- row they check (Supabase advisor "auth_rls_initplan"). Wrapping the call in (select …) lets Postgres
-- evaluate it once per statement as an InitPlan. The shared-collection checks also become an
-- uncorrelated `IN (select owner_user_id from partnerships …)`, which runs once per statement instead of
-- once per row.
-- Access rules are unchanged: every policy keeps its command, roles and meaning. ALTER POLICY swaps the
-- expressions in place, so there is no moment without a policy. Idempotent: safe to re-run.

-- pokemon_collection: own rows, or the owner's rows for a partner
ALTER POLICY "Users can view own or shared collection" ON public.pokemon_collection
  USING (
    user_id = (select auth.uid())
    OR user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );
ALTER POLICY "Users can insert into own or shared collection" ON public.pokemon_collection
  WITH CHECK (
    user_id = (select auth.uid())
    OR user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );
ALTER POLICY "Users can update own or shared collection" ON public.pokemon_collection
  USING (
    user_id = (select auth.uid())
    OR user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  )
  WITH CHECK (
    user_id = (select auth.uid())
    OR user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );
ALTER POLICY "Users can delete from own or shared collection" ON public.pokemon_collection
  USING (
    user_id = (select auth.uid())
    OR user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );

-- binder_appearances / collection_activity: owner or partner can read
ALTER POLICY "Read own or partner appearance" ON public.binder_appearances
  USING (
    owner_user_id = (select auth.uid())
    OR owner_user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );
ALTER POLICY "Read own or partner activity" ON public.collection_activity
  USING (
    owner_user_id = (select auth.uid())
    OR owner_user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );

-- user_settings
ALTER POLICY "Users can view own settings" ON public.user_settings USING (user_id = (select auth.uid()));
ALTER POLICY "Users can insert own settings" ON public.user_settings WITH CHECK (user_id = (select auth.uid()));
ALTER POLICY "Users can update own settings" ON public.user_settings USING (user_id = (select auth.uid()));

-- binder_shares
ALTER POLICY "Users can view their own binder share" ON public.binder_shares USING (owner_user_id = (select auth.uid()));
ALTER POLICY "Users can insert their own binder share" ON public.binder_shares WITH CHECK (owner_user_id = (select auth.uid()));
ALTER POLICY "Users can update their own binder share" ON public.binder_shares
  USING (owner_user_id = (select auth.uid())) WITH CHECK (owner_user_id = (select auth.uid()));
ALTER POLICY "Users can delete their own binder share" ON public.binder_shares USING (owner_user_id = (select auth.uid()));

-- Passkeys were removed before the tracked schema; fresh projects have no such table.
DO $$
BEGIN
  IF to_regclass('public.passkey_credentials') IS NOT NULL THEN
    ALTER POLICY "Users can view own passkeys" ON public.passkey_credentials USING (user_id = (select auth.uid()));
    ALTER POLICY "Users can insert own passkeys" ON public.passkey_credentials WITH CHECK (user_id = (select auth.uid()));
    ALTER POLICY "Users can update own passkeys" ON public.passkey_credentials USING (user_id = (select auth.uid()));
    ALTER POLICY "Users can delete own passkeys" ON public.passkey_credentials USING (user_id = (select auth.uid()));
  END IF;
END $$;

-- partnerships
ALTER POLICY "Users can view their partnerships" ON public.partnerships
  USING (user1_id = (select auth.uid()) OR user2_id = (select auth.uid()));
ALTER POLICY "Users can delete their partnerships" ON public.partnerships
  USING (user1_id = (select auth.uid()) OR user2_id = (select auth.uid()));
ALTER POLICY "Users can create partnerships" ON public.partnerships
  WITH CHECK (
    user1_id <> user2_id
    AND (owner_user_id = user1_id OR owner_user_id = user2_id)
    AND (select auth.uid()) = CASE WHEN owner_user_id = user1_id THEN user2_id ELSE user1_id END
    AND EXISTS (
      SELECT 1 FROM public.partner_invites i
      WHERE i.inviter_id = partnerships.owner_user_id
        AND i.invitee_email = COALESCE((select auth.jwt()) ->> 'email', '')
        AND i.status = 'pending'
    )
  );

-- partner_invites
ALTER POLICY "Users can view invites they sent or received" ON public.partner_invites
  USING (inviter_id = (select auth.uid()) OR invitee_email = COALESCE((select auth.jwt()) ->> 'email', ''));
ALTER POLICY "Users can create invites" ON public.partner_invites WITH CHECK (inviter_id = (select auth.uid()));
ALTER POLICY "Users can update invites they received" ON public.partner_invites
  USING (invitee_email = COALESCE((select auth.jwt()) ->> 'email', '') AND status = 'pending')
  WITH CHECK (invitee_email = COALESCE((select auth.jwt()) ->> 'email', '') AND status IN ('accepted', 'rejected'));

-- Legacy cache jobs were removed before the tracked schema too.
DO $$
BEGIN
  IF to_regclass('public.tcgdex_cache_jobs') IS NOT NULL THEN
    ALTER POLICY "Authenticated users can read cache jobs" ON public.tcgdex_cache_jobs
      USING ((select auth.role()) = 'authenticated');
    ALTER POLICY "Authenticated users can create cache jobs" ON public.tcgdex_cache_jobs
      WITH CHECK (requested_by IS NULL OR requested_by = (select auth.uid()));
  END IF;
END $$;

-- The shared-collection checks look partnerships up by owner; index it (also covers the owner foreign key).
CREATE INDEX IF NOT EXISTS idx_partnerships_owner_user_id ON public.partnerships(owner_user_id);
