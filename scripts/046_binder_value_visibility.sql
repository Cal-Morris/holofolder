-- Optional display preference; older clients keep working and existing binders remain visible.
SET lock_timeout = '3s';
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS show_binder_value BOOLEAN NOT NULL DEFAULT true;
NOTIFY pgrst, 'reload schema';
