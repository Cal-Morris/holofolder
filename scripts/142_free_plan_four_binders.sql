-- The free plan includes four binders (was one). enforce_binder_billing (052) compares new inserts against
-- free_binder_limit, so only the value changes. It only checks inserts, so owners already above four keep every
-- binder. The app reads the limit from get_billing_access, so it follows this row. Idempotent.
ALTER TABLE public.billing_configuration ALTER COLUMN free_binder_limit SET DEFAULT 4;
UPDATE public.billing_configuration SET free_binder_limit = 4 WHERE free_binder_limit IS DISTINCT FROM 4;
