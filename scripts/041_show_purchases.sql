-- Show mode purchase log on the account (was device-only).
-- * One row per card bought at a card show, owned by the collection owner (like binders and the collection),
--   so it survives a reinstall and a shared partner sees and adds to the same log.
-- * client_id is the purchase id made on the device; UNIQUE (owner_user_id, client_id) makes the offline
--   queue's retries idempotent (inserts use ON CONFLICT DO NOTHING), so a purchase is never stored twice.
-- * RLS: the owner, or a partner of the owner (public.partnerships), can read, add and delete (Undo).
--   Rows are never updated.
-- Additive and idempotent; one transaction. The app before this ignores the table, and the app after it keeps
-- purchases queued on the device until the table exists.

SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.show_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  created_by UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  card_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  finish TEXT NOT NULL DEFAULT 'normal',
  price NUMERIC(12, 2) NOT NULL,
  market_price NUMERIC(12, 2),
  currency TEXT NOT NULL,
  bought_at TIMESTAMPTZ NOT NULL,
  bundle_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT show_purchases_owner_client_unique UNIQUE (owner_user_id, client_id),
  CONSTRAINT show_purchases_client_id_check CHECK (char_length(client_id) BETWEEN 1 AND 64),
  CONSTRAINT show_purchases_card_check CHECK (char_length(card_id) BETWEEN 1 AND 64 AND char_length(card_name) BETWEEN 1 AND 200),
  CONSTRAINT show_purchases_text_check CHECK (
    char_length(language) <= 16 AND char_length(finish) <= 32 AND char_length(currency) BETWEEN 1 AND 8
    AND (bundle_id IS NULL OR char_length(bundle_id) <= 64)
  ),
  CONSTRAINT show_purchases_price_check CHECK (price >= 0 AND (market_price IS NULL OR market_price >= 0))
);

-- The tally's pull: "owner_user_id = $1 AND bought_at >= $2 ORDER BY bought_at".
CREATE INDEX IF NOT EXISTS idx_show_purchases_owner_bought_at ON public.show_purchases(owner_user_id, bought_at);
CREATE INDEX IF NOT EXISTS idx_show_purchases_created_by ON public.show_purchases(created_by);

ALTER TABLE public.show_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.show_purchases FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.show_purchases TO authenticated;
GRANT ALL ON public.show_purchases TO service_role;

DROP POLICY IF EXISTS "Read own or partner show purchases" ON public.show_purchases;
CREATE POLICY "Read own or partner show purchases" ON public.show_purchases FOR SELECT TO authenticated
  USING (
    owner_user_id = (select auth.uid())
    OR owner_user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );

DROP POLICY IF EXISTS "Add own or partner show purchases" ON public.show_purchases;
CREATE POLICY "Add own or partner show purchases" ON public.show_purchases FOR INSERT TO authenticated
  WITH CHECK (
    (created_by IS NULL OR created_by = (select auth.uid()))
    AND (
      owner_user_id = (select auth.uid())
      OR owner_user_id IN (
        SELECT p.owner_user_id FROM public.partnerships p
        WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "Delete own or partner show purchases" ON public.show_purchases;
CREATE POLICY "Delete own or partner show purchases" ON public.show_purchases FOR DELETE TO authenticated
  USING (
    owner_user_id = (select auth.uid())
    OR owner_user_id IN (
      SELECT p.owner_user_id FROM public.partnerships p
      WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
    )
  );
