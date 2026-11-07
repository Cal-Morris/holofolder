-- Reconcile the independent account-identity release with named binder sharing.
-- 047 is canonical. Preserve any older 045 claims/reservations before switching readers.
SET lock_timeout = '3s';
-- Keep claims from racing the reservation copy and canonical-source switch.
LOCK TABLE public.account_usernames, public.account_identities, public.account_username_reservations IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.account_usernames old
    JOIN public.account_username_reservations current USING (username)
    WHERE current.user_id IS DISTINCT FROM coalesce(old.user_id, md5('deleted-account-username:' || old.username)::uuid)
  ) THEN
    RAISE EXCEPTION 'Conflicting account username reservations require reconciliation';
  END IF;
END;
$$;
INSERT INTO public.account_username_reservations(username, user_id)
SELECT username, coalesce(user_id, md5('deleted-account-username:' || username)::uuid) FROM public.account_usernames
ON CONFLICT (username) DO NOTHING;
INSERT INTO public.account_identities(user_id, username)
SELECT old.user_id, old.username FROM public.account_usernames old
WHERE old.is_active AND old.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.account_identities current WHERE current.user_id = old.user_id)
ON CONFLICT DO NOTHING;
-- All names now live in canonical reservations, including deleted-account tombstones.
DELETE FROM public.account_usernames;

-- Compatibility for clients that already know the earlier claim RPC.
CREATE OR REPLACE FUNCTION public.set_account_username(requested_username TEXT)
RETURNS TEXT LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT public.claim_account_username(requested_username);
$$;
REVOKE ALL ON FUNCTION public.set_account_username(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_account_username(TEXT) TO authenticated;
CREATE OR REPLACE FUNCTION public.resolve_named_binder_share(requested_username TEXT, requested_slug TEXT)
RETURNS TABLE (owner_user_id UUID, binder_id UUID, token TEXT, is_enabled BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT shares.owner_user_id, shares.binder_id, shares.token, shares.is_enabled
  FROM public.account_identities names
  JOIN public.binder_public_slugs slugs ON slugs.owner_user_id = names.user_id
  JOIN public.binders binders ON binders.id = slugs.binder_id AND binders.owner_user_id = names.user_id
  JOIN public.binder_shares shares ON shares.owner_user_id = names.user_id AND shares.binder_id = binders.id
  WHERE names.username = requested_username AND slugs.slug = requested_slug AND slugs.is_active AND shares.is_enabled;
$$;
REVOKE ALL ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
