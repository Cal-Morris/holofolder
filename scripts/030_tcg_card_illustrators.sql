-- Browse cards by illustrator.
-- tcg_cards.illustrator already exists (004) and is filled by the TCGdex sync; this adds an index for the
-- per-illustrator card list and a small directory function (name + card count) for illustrator search.
-- Idempotent: safe to re-run. The app works before this is applied (it falls back to paging the column).

CREATE INDEX IF NOT EXISTS idx_tcg_cards_illustrator
  ON public.tcg_cards(illustrator)
  WHERE illustrator IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tcg_illustrator_directory()
RETURNS TABLE (illustrator TEXT, card_count INTEGER)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT c.illustrator, count(*)::integer AS card_count
  FROM public.tcg_cards AS c
  WHERE c.illustrator IS NOT NULL
    AND btrim(c.illustrator) <> ''
    AND c.set_id <> 'jumbo'
  GROUP BY c.illustrator
  ORDER BY card_count DESC, c.illustrator;
$$;

-- tcg_cards is world-readable (RLS "Anyone can read TCG cards"), so the directory is too.
REVOKE ALL ON FUNCTION public.tcg_illustrator_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tcg_illustrator_directory() TO anon, authenticated, service_role;

-- Ask PostgREST to pick up the new function straight away.
NOTIFY pgrst, 'reload schema';
