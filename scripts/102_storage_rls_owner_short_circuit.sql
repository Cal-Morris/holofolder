-- 102: let owner reads of native storage skip the per-row billing check.
-- 073 wrote (owner OR partner) AND billing_partner_allowed(owner, actor). The SECURITY DEFINER
-- helper can't be inlined, so it ran once per row even for the owner's own rows. The helper
-- already returns true when actor = owner, so owner OR (partner AND billing) admits exactly
-- the same rows: partners still need membership and billing, anon/null actors still get nothing.
-- ALTER POLICY keeps the name, roles and command, never leaves a table without its policy and
-- is safe to rerun.
SET lock_timeout = '3s';
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binder_legacy_rows'] LOOP
   EXECUTE format('ALTER POLICY storage_owner_partner_read ON public.%I USING (
     owner_user_id = (select auth.uid()) OR (owner_user_id IN (
       SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid()))
     AND public.billing_partner_allowed(owner_user_id,(select auth.uid()))))',table_name);
 END LOOP;
END $$;
RESET lock_timeout;
