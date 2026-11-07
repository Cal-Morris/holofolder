-- URL identity is authoritative here, never in editable auth user metadata.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.account_identities (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$')
);
-- No auth FK: deleting an account must not release previously shared addresses.
CREATE TABLE IF NOT EXISTS public.account_username_reservations (
  username text PRIMARY KEY CHECK (username ~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$'),
  user_id uuid NOT NULL
);
ALTER TABLE public.account_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_username_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_identities, public.account_username_reservations FROM anon, authenticated;
GRANT SELECT ON public.account_identities TO authenticated;
GRANT ALL ON public.account_identities, public.account_username_reservations TO service_role;
DROP POLICY IF EXISTS account_identity_read_self ON public.account_identities;
CREATE POLICY account_identity_read_self ON public.account_identities FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

CREATE OR REPLACE FUNCTION public.claim_account_username(p_username text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := (select auth.uid());
  claimed text := lower(btrim(p_username));
  reserved_by uuid;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  IF claimed IS NULL OR claimed !~ '^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$' THEN
    RAISE EXCEPTION 'Invalid username' USING ERRCODE = '22023';
  END IF;
  -- Serialize this account's renames, including concurrent first claims.
  PERFORM id FROM auth.users WHERE id = actor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.account_username_reservations(username, user_id) VALUES (claimed, actor) ON CONFLICT DO NOTHING;
  SELECT user_id INTO reserved_by FROM public.account_username_reservations WHERE username = claimed;
  IF reserved_by IS DISTINCT FROM actor THEN
    RAISE EXCEPTION 'Username already taken' USING ERRCODE = '23505';
  END IF;
  INSERT INTO public.account_identities(user_id, username) VALUES (actor, claimed)
    ON CONFLICT (user_id) DO UPDATE SET username = excluded.username;
  RETURN claimed;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_account_username(text) TO authenticated;
NOTIFY pgrst, 'reload schema';
