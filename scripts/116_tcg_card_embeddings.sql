-- Card picture embeddings for similarity search ("Same artwork" and "Similar look" on the card detail).
-- Filled by `bun run card-assets fingerprints --db`; one row per card, print language and model.
-- A separate table on purpose: embeddings are rebuilt by their own job, independently of the card sync (which only
-- upserts). Rows for cards that disappear are removed by the next `fingerprints --db` run.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.tcg_card_embeddings (
  card_id text NOT NULL,
  lang text NOT NULL,
  model text NOT NULL,
  embedding extensions.halfvec(384) NOT NULL,
  image_key text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (card_id, lang, model)
);

CREATE INDEX IF NOT EXISTS idx_tcg_card_embeddings_hnsw
  ON public.tcg_card_embeddings USING hnsw (embedding extensions.halfvec_cosine_ops);

-- Public catalogue data, read like the other tcg mirror tables; no client writes (only the service role writes).
ALTER TABLE public.tcg_card_embeddings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can read TCG card embeddings" ON public.tcg_card_embeddings;
CREATE POLICY "Anyone can read TCG card embeddings"
  ON public.tcg_card_embeddings FOR SELECT
  USING (true);

-- Nearest neighbours of one card's picture, across every print language, by cosine similarity (1 = identical).
-- The query vector is a variable so the planner uses the HNSW index (a lateral join to the query row falls back to a
-- full sort). The app calls it through the service role and caches the result (lib/tcg-mirror.ts), so it isn't
-- exposed to anon or authenticated callers.
CREATE OR REPLACE FUNCTION public.similar_tcg_cards(p_card_id text, p_lang text, p_model text, p_limit integer DEFAULT 48)
RETURNS TABLE (card_id text, lang text, similarity real)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
SET hnsw.ef_search = 100
AS $$
DECLARE
  query_embedding extensions.halfvec;
BEGIN
  SELECT q.embedding INTO query_embedding
  FROM public.tcg_card_embeddings q
  WHERE q.card_id = p_card_id AND q.lang = p_lang AND q.model = p_model;
  IF query_embedding IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT n.card_id, n.lang, (1 - n.distance)::real
  FROM (
    SELECT e.card_id, e.lang, e.embedding <=> query_embedding AS distance
    FROM public.tcg_card_embeddings e
    WHERE e.model = p_model
    ORDER BY e.embedding <=> query_embedding
    LIMIT least(greatest(p_limit, 1), 100) + 1
  ) n
  WHERE NOT (n.card_id = p_card_id AND n.lang = p_lang)
  ORDER BY n.distance;
END;
$$;

REVOKE ALL ON FUNCTION public.similar_tcg_cards(text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.similar_tcg_cards(text, text, text, integer) TO service_role;
