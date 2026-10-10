CREATE TABLE IF NOT EXISTS public.binder_appearances (
  owner_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  design JSONB NOT NULL,
  revision BIGINT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT binder_appearances_design_check CHECK (jsonb_typeof(design) = 'object' AND (design->>'version' = '1') IS TRUE),
  CONSTRAINT binder_appearances_revision_check CHECK (revision > 0 AND revision <= 9007199254740991)
);

ALTER TABLE public.binder_appearances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.binder_appearances FROM anon, authenticated;
GRANT SELECT ON public.binder_appearances TO authenticated;
GRANT ALL ON public.binder_appearances TO service_role;

DROP POLICY IF EXISTS "Read own or partner appearance" ON public.binder_appearances;
CREATE POLICY "Read own or partner appearance"
  ON public.binder_appearances FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_user_id
    OR EXISTS (
      SELECT 1 FROM public.partnerships
      WHERE partnerships.owner_user_id = binder_appearances.owner_user_id
        AND (partnerships.user1_id = auth.uid() OR partnerships.user2_id = auth.uid())
    )
  );

-- Artwork bytes stay private; the server grants one immutable path per upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('binder-artwork', 'binder-artwork', false, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Restrictive policies prevent broad existing storage policies exposing this bucket.
DROP POLICY IF EXISTS "Private binder artwork" ON storage.objects;
CREATE POLICY "Private binder artwork"
  ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'binder-artwork')
  WITH CHECK (bucket_id <> 'binder-artwork');
