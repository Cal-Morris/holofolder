ALTER TABLE public.partnerships
ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

UPDATE public.partnerships
SET owner_user_id = COALESCE(owner_user_id, user1_id)
WHERE owner_user_id IS NULL;

DROP POLICY IF EXISTS "Users can view their own collection" ON public.pokemon_collection;
DROP POLICY IF EXISTS "Users can view own or partner collection" ON public.pokemon_collection;
CREATE POLICY "Users can view own or shared collection"
  ON public.pokemon_collection FOR SELECT
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.partnerships
      WHERE partnerships.owner_user_id = pokemon_collection.user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can insert into their own collection" ON public.pokemon_collection;
CREATE POLICY "Users can insert into own or shared collection"
  ON public.pokemon_collection FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.partnerships
      WHERE partnerships.owner_user_id = pokemon_collection.user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can update their own collection" ON public.pokemon_collection;
CREATE POLICY "Users can update own or shared collection"
  ON public.pokemon_collection FOR UPDATE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.partnerships
      WHERE partnerships.owner_user_id = pokemon_collection.user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.partnerships
      WHERE partnerships.owner_user_id = pokemon_collection.user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Users can delete from their own collection" ON public.pokemon_collection;
CREATE POLICY "Users can delete from own or shared collection"
  ON public.pokemon_collection FOR DELETE
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.partnerships
      WHERE partnerships.owner_user_id = pokemon_collection.user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  );
