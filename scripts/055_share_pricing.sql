-- Adding the column backfills every existing share with pricing disabled.
SET lock_timeout = '3s';
ALTER TABLE public.binder_shares ADD COLUMN IF NOT EXISTS show_prices BOOLEAN NOT NULL DEFAULT false;

-- The return type changes, so replace the function and restore its service-only grant.
DROP FUNCTION IF EXISTS public.resolve_named_binder_share(TEXT, TEXT);
CREATE FUNCTION public.resolve_named_binder_share(requested_username TEXT, requested_slug TEXT)
RETURNS TABLE (owner_user_id UUID, binder_id UUID, token TEXT, is_enabled BOOLEAN, show_prices BOOLEAN)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT shares.owner_user_id, shares.binder_id, shares.token, shares.is_enabled, shares.show_prices
  FROM public.account_identities names
  JOIN public.binder_public_slugs slugs ON slugs.owner_user_id = names.user_id
  JOIN public.binders binders ON binders.id = slugs.binder_id AND binders.owner_user_id = names.user_id
  JOIN public.binder_shares shares ON shares.owner_user_id = names.user_id AND shares.binder_id = binders.id
  WHERE names.username = requested_username AND slugs.slug = requested_slug AND slugs.is_active AND shares.is_enabled;
$$;
REVOKE ALL ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_named_binder_share(TEXT, TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
