-- Drops the retired passkey_credentials table. Passkey support was removed (see 036), it has no rows and no
-- app code reads or writes it. Its four owner-only policies go with it. No CASCADE.
DROP TABLE IF EXISTS public.passkey_credentials;
