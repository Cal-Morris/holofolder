-- Illustrator directory counts distinct catalog cards, not rows.
-- Some cards are mirrored more than once (an alias row whose external_ids_json.catalog.canonicalId points at the
-- canonical card). The illustrator view dedupes those (deduplicateCatalogCards), so the directory must too, or Search
-- shows a higher count than the view. Same signature as 030, so the app works before and after this is applied.
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.tcg_illustrator_directory()
RETURNS TABLE (illustrator TEXT, card_count INTEGER)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    c.illustrator,
    count(DISTINCT coalesce(nullif(c.external_ids_json->'catalog'->>'canonicalId', ''), c.id))::integer AS card_count
  FROM public.tcg_cards AS c
  WHERE c.illustrator IS NOT NULL
    AND btrim(c.illustrator) <> ''
    AND c.set_id <> 'jumbo'
  GROUP BY c.illustrator
  ORDER BY card_count DESC, c.illustrator;
$$;

REVOKE ALL ON FUNCTION public.tcg_illustrator_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tcg_illustrator_directory() TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
