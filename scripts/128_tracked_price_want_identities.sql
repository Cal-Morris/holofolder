-- The daily price refresh only needs the distinct (card, language, finish) of every want, not each
-- slot's whole wanted_cards array (names, notes, costs). One statement, so one snapshot, and one
-- jsonb value, so PostgREST's row cap does not apply. Absent or null language/finish keys are
-- omitted, matching what binder_slots stores (valid_slot_wants_v1 already validates every want).
-- Service role only. Safe to rerun.
CREATE OR REPLACE FUNCTION public.tracked_price_want_identities_v1(p_owner uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_strip_nulls(jsonb_build_object(
    'card_id', want->'card_id',
    'card_language', want->'card_language',
    'card_finish', want->'card_finish'
  ))), '[]'::jsonb)
  FROM public.binder_slots slot
  CROSS JOIN LATERAL jsonb_array_elements(slot.wanted_cards) want
  WHERE slot.wanted_cards <> '[]'::jsonb
    AND (p_owner IS NULL OR slot.owner_user_id = p_owner)
$$;
REVOKE ALL ON FUNCTION public.tracked_price_want_identities_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_price_want_identities_v1(uuid) TO service_role;
