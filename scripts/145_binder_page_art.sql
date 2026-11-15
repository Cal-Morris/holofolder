-- 145: Michi method page art. One list per binder of artworks laid behind a rectangle of pockets, each anchored to
-- its top-left pocket's slot id so it follows that pocket through page moves. NULL means no page art.
-- Written through PATCH /api/binders (owner or partner via the service role), like the name and card languages.
-- The app validates each entry (lib/page-art.ts); the database only bounds the shape and size.
BEGIN;
SET LOCAL lock_timeout = '3s';
ALTER TABLE public.binders ADD COLUMN IF NOT EXISTS page_art jsonb;
ALTER TABLE public.binders DROP CONSTRAINT IF EXISTS binders_page_art_check;
ALTER TABLE public.binders ADD CONSTRAINT binders_page_art_check CHECK (
  page_art IS NULL OR (
    jsonb_typeof(page_art) = 'array'
    AND jsonb_array_length(page_art) <= 200
    AND pg_column_size(page_art) <= 131072
  )
);
COMMIT;
