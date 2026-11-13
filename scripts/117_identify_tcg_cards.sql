-- 117: nearest cards to a picture fingerprint, for identifying a card from a photo (POST /cards/identify, identify_card
-- and the app's online scans). The caller computes the fingerprint (lib/card-picture-fingerprint.ts) and passes it as
-- pgvector text. Uses the HNSW index from 116; with a language filter, iterative scanning keeps going until enough
-- rows of those languages are found. Service role only, like similar_tcg_cards.
CREATE OR REPLACE FUNCTION public.identify_tcg_cards(
  p_embedding text,
  p_model text,
  p_langs text[] DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS TABLE (card_id text, lang text, similarity real)
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions
SET hnsw.ef_search = 100
SET hnsw.iterative_scan = relaxed_order
AS $$
DECLARE
  query_embedding extensions.halfvec := p_embedding::extensions.halfvec(384);
BEGIN
  RETURN QUERY
  SELECT n.card_id, n.lang, (1 - n.distance)::real
  FROM (
    SELECT e.card_id, e.lang, e.embedding <=> query_embedding AS distance
    FROM public.tcg_card_embeddings e
    WHERE e.model = p_model AND (p_langs IS NULL OR e.lang = ANY (p_langs))
    ORDER BY e.embedding <=> query_embedding
    LIMIT least(greatest(p_limit, 1), 50)
  ) n
  ORDER BY n.distance;
END;
$$;

REVOKE ALL ON FUNCTION public.identify_tcg_cards(text, text, text[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identify_tcg_cards(text, text, text[], integer) TO service_role;
