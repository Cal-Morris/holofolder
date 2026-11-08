-- Public links are opt-in and read-only; existing owner-only policies remain authoritative.
SET lock_timeout = '3s';
DROP POLICY IF EXISTS billing_share_insert ON public.binder_shares;
DROP POLICY IF EXISTS billing_share_update ON public.binder_shares;
NOTIFY pgrst,'reload schema';
