-- Free plan saved entries become unlimited. Enforcement triggers and RPCs from 052 onwards still compare against
-- free_card_limit, so the largest integer value means "no cap" without rewriting them. The one-binder free limit stays.
-- The app (lib/billing.ts UNLIMITED_FREE_CARD_LIMIT) treats this value as unlimited. Idempotent.
ALTER TABLE public.billing_configuration ALTER COLUMN free_card_limit SET DEFAULT 2147483647;
UPDATE public.billing_configuration SET free_card_limit = 2147483647 WHERE free_card_limit IS DISTINCT FROM 2147483647;
