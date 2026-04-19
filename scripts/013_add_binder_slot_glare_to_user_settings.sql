ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS binder_slot_glare_enabled BOOLEAN NOT NULL DEFAULT TRUE;
