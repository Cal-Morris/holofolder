-- One SELECT policy on binder_public_slugs instead of two permissive ones (Supabase advisor 0006),
-- so Postgres evaluates one expression per row. Same access as 045 + 106 combined.
DROP POLICY IF EXISTS "Read own binder slugs" ON public.binder_public_slugs;
DROP POLICY IF EXISTS "Read slugs of readable binders" ON public.binder_public_slugs;
DROP POLICY IF EXISTS "Read own or readable binder slugs" ON public.binder_public_slugs;
CREATE POLICY "Read own or readable binder slugs" ON public.binder_public_slugs FOR SELECT TO authenticated
  USING (owner_user_id = (select auth.uid())
    OR (is_active AND EXISTS (SELECT 1 FROM public.binders b WHERE b.id = binder_id)));
