ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS binder_color_id TEXT;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS binder_page_colors JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.user_settings
SET binder_page_colors = '{}'::jsonb
WHERE binder_page_colors IS NULL;
