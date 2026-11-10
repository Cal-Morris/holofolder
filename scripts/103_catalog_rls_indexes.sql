-- 103: catalog fallback lookup, billing RLS short-circuits and small index fixes.
-- Every change returns exactly the same rows as before. Apply with psql in autocommit
-- (no --single-transaction): the CONCURRENTLY statements at the end can't run in a transaction.

-- 1. slot_catalog_card_v1: when the key isn't a tcg_cards id, the fallback called the PL/pgSQL
-- slot_catalog_ids_v1 on all ~22k cards. Those ids are the card id (already ruled out above),
-- a string canonicalId and string aliasIds, so the indexed prefilter below is a superset of the
-- matches; the unchanged ANY(...) recheck keeps the exact rule and the two-match ambiguity limit.
CREATE OR REPLACE FUNCTION public.slot_catalog_card_v1(card_key text)
 RETURNS public.tcg_cards
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE card public.tcg_cards; found_ids text[];
BEGIN
 SELECT * INTO card FROM public.tcg_cards WHERE id=card_key;
 IF FOUND THEN RETURN card; END IF;
 -- Canonical/alias fallback is bounded to two matches and refuses ambiguous stored evidence.
 SELECT array_agg(id) INTO found_ids FROM (SELECT c.id FROM public.tcg_cards c
   WHERE (c.external_ids_json->'catalog'->>'canonicalId'=card_key OR c.external_ids_json->'catalog'->'aliasIds' ? card_key)
     AND card_key=ANY(public.slot_catalog_ids_v1(c)) LIMIT 2) matches;
 IF cardinality(found_ids)=1 THEN SELECT * INTO card FROM public.tcg_cards WHERE id=found_ids[1]; RETURN card; END IF;
 RETURN NULL;
END $function$;

-- 2. Billing RLS. billing_partner_allowed(owner, actor) is SECURITY DEFINER, so it can't be inlined
-- and ran on every row. Its body is actor = owner OR (billing ok AND a partnership with that owner
-- includes actor). So for any row: owner = actor, or the owner is one of the actor's partnerships
-- whose billing check passes. That check depends only on (owner, actor), so it now runs once per
-- partnership in an uncorrelated subquery instead of once per row. The partnerships RLS shows a
-- user exactly the rows where they are user1 or user2, the same filter used here.
SET lock_timeout = '3s';
DO $$
DECLARE target record;
BEGIN
 FOR target IN SELECT * FROM (VALUES
   ('binders','owner_user_id'),('pokemon_collection','user_id'),('user_settings','user_id'),
   ('collection_activity','owner_user_id'),('binder_appearances','owner_user_id'),('show_purchases','owner_user_id')) AS t(table_name, owner_column)
 LOOP
   EXECUTE format('ALTER POLICY billing_partner_access ON public.%1$I USING (%2$s) WITH CHECK (%2$s)', target.table_name,
     format('%1$I = (select auth.uid()) OR %1$I IN (
       SELECT p.owner_user_id FROM public.partnerships p
       WHERE (p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid()))
         AND public.billing_partner_allowed(p.owner_user_id, (select auth.uid())))', target.owner_column));
 END LOOP;
 -- Native storage partner reads: same move, billing inside the partnerships subquery.
 -- binder_legacy_rows is left alone; it is being dropped.
 FOR target IN SELECT unnest(ARRAY['inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements']) AS table_name
 LOOP
   EXECUTE format('ALTER POLICY storage_owner_partner_read ON public.%I USING (
     owner_user_id = (select auth.uid()) OR owner_user_id IN (
       SELECT p.owner_user_id FROM public.partnerships p
       WHERE (p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid()))
         AND public.billing_partner_allowed(p.owner_user_id, (select auth.uid()))))', target.table_name);
 END LOOP;
END $$;
-- collection_activity also has the restrictive billing_partner_access policy above, so the
-- billing check in its read policy was evaluated twice per row. Dropping it here is equivalent:
-- (own OR partner) AND billing  =  (own OR partner) AND (own OR billing).
ALTER POLICY "Read own or partner activity" ON public.collection_activity USING (
  owner_user_id = (select auth.uid()) OR owner_user_id IN (
    SELECT partnerships.owner_user_id FROM public.partnerships
    WHERE partnerships.user1_id = (select auth.uid()) OR partnerships.user2_id = (select auth.uid())));
RESET lock_timeout;

-- 3. Indexes. Run each statement on its own (autocommit).
-- Catalog fallback (slot_catalog_card_v1 above and lib/server/inventory-read-catalog.ts).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_catalog_canonical_id
  ON public.tcg_cards ((external_ids_json->'catalog'->>'canonicalId'))
  WHERE (external_ids_json->'catalog'->>'canonicalId') IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tcg_cards_catalog_alias_ids
  ON public.tcg_cards USING gin ((external_ids_json->'catalog'->'aliasIds'));
-- consume_developer_budget's cleanup DELETE filters on window_start alone; the primary key
-- leads with bucket, so every developer API call seq-scanned the table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_developer_request_budgets_window_start
  ON public.developer_request_budgets (window_start);
-- tcgdex_cache_jobs is retired (no code reads or writes it; fresh installs don't have it) and these
-- two indexes have never been scanned. requested_by stays: it covers an ON DELETE CASCADE foreign key.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tcgdex_cache_jobs_created_at;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_tcgdex_cache_jobs_active;
