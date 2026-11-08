-- passkey_credentials: drop the "Service can lookup credentials by id" policy, which was USING (true) for every role,
-- so anyone (signed out, or any other user) could read every user's passkey rows through the Data API.
-- Credential lookups during sign-in must use the service-role client server-side (it bypasses RLS); users keep
-- owner-only access through the existing "Users can … own passkeys" policies. Signed-out visitors get no table access.
--
-- The app has no passkey code today (support was removed), so nothing depends on the open policy.
-- Idempotent.

DO $$
BEGIN
  IF to_regclass('public.passkey_credentials') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Service can lookup credentials by id" ON public.passkey_credentials;
    REVOKE ALL ON public.passkey_credentials FROM anon;
  END IF;
END $$;
