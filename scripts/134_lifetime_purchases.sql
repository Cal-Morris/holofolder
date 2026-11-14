-- Lifetime purchases: a verified £79 Checkout (or a 100% creator code) grants the existing perpetual licence.
-- The session ID keys the grant so webhook replays are no-ops; the promotion code records which creator code was used.
SET lock_timeout = '3s';
ALTER TABLE public.perpetual_licences
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text UNIQUE
    CHECK (stripe_checkout_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{1,200}$'),
  ADD COLUMN IF NOT EXISTS stripe_promotion_code_id text
    CHECK (stripe_promotion_code_id ~ '^promo_[A-Za-z0-9]{1,100}$');
ALTER TABLE public.perpetual_licences DROP CONSTRAINT IF EXISTS perpetual_licences_source_check;
ALTER TABLE public.perpetual_licences ADD CONSTRAINT perpetual_licences_source_check
  CHECK (source IN ('grandfathered', 'manual', 'purchase'));
