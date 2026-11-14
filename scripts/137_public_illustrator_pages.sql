-- Public illustrator pages (/app/illustrators and /app/illustrators/<slug>).
-- 1. No binder may take "illustrators" as its address. Same function as 136 plus "illustrators"; mirrors
--    RESERVED_BINDER_SLUGS in lib/binders/url.ts. Checked before applying: no binder_public_slugs row uses it.
-- 2. public_illustrator_directory(): illustrators with their card counts in sets that have an English name, the sets
--    the public set pages list. tcg_illustrator_directory() (030) counts every language, so its counts don't match
--    pages that list English cards.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.binder_slug_reserved(slug text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT slug = ANY (ARRAY['api','app-shell','auth','docs','e2e-harness','home','mcp','oauth','share','studio','u',
    'settings','admin','new','login','logout','account','inventory','dex','offline','help','credits','sets','pokemon',
    'illustrators'])
$$;

CREATE OR REPLACE FUNCTION public.public_illustrator_directory()
RETURNS TABLE (illustrator TEXT, card_count INTEGER)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.illustrator, count(*)::integer AS card_count
  FROM public.tcg_cards AS c
  JOIN public.tcg_sets AS s ON s.id = c.set_id
  WHERE c.illustrator IS NOT NULL
    AND btrim(c.illustrator) <> ''
    AND c.set_id <> 'jumbo'
    AND s.name_json->>'en' IS NOT NULL
  GROUP BY c.illustrator
  ORDER BY card_count DESC, c.illustrator;
$$;

REVOKE ALL ON FUNCTION public.public_illustrator_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_illustrator_directory() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
