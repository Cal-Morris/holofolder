-- Synthetic, rollback-only integration proof. Run after 073 on an isolated restored database.
-- Also safe to review for later hosted verification, but production execution is parent-owned.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE FUNCTION pg_temp.assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',message; END IF; END $$;
-- Unique synthetic IDs; fail rather than overwrite any existing account.
INSERT INTO auth.users(id) VALUES
 ('03610000-0000-4000-8000-000000000001'),('03610000-0000-4000-8000-000000000002'),('03610000-0000-4000-8000-000000000003');
-- Fixture creation must not depend on the current free allowance/trial setting.
INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES
 ('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001','Synthetic legacy binder',true),
 ('03610000-0000-4000-8000-000000000012','03610000-0000-4000-8000-000000000002','Synthetic empty binder',true);
INSERT INTO public.pokemon_collection(id,binder_id,user_id,pokemon_id,pokemon_name,status,card_id,card_name,card_language,card_finish,collected_at,wanted_cards) VALUES
 ('03610000-0000-4000-8000-000000000021','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',1,'Synthetic one','collected','synthetic-print','Synthetic card','ja','holo','2020-01-02T03:04:05Z','[]'),
 ('03610000-0000-4000-8000-000000000022','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',2,'Synthetic two','finalized','synthetic-print','Synthetic card','ja','holo','2021-01-02T03:04:05Z','[]'),
 ('03610000-0000-4000-8000-000000000023','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',3,'Synthetic unknown','collected',NULL,NULL,'en','normal',NULL,'[]'),
 ('03610000-0000-4000-8000-000000000024','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',4,'Synthetic want','wishlisted',NULL,NULL,'en','normal','2022-01-02T03:04:05Z',
  '[{"card_id":"synthetic-want","card_name":"Synthetic wanted card","added_at":"2022-01-02T03:04:05Z","wanted_by":["03610000-0000-4000-8000-000000000002"],"card_finish":"reverse_holo","card_language":"fr"},{"card_id":"synthetic-want","card_name":"Synthetic duplicate want","added_at":"2022-01-02T03:04:05Z"}]'),
 ('03610000-0000-4000-8000-000000000025','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',5,'Synthetic old want','wishlisted','synthetic-old-want','Synthetic old wanted card','de','normal','2019-01-02T03:04:05Z','[]'),
 ('03610000-0000-4000-8000-000000000026','03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',6,'Synthetic considering','considering',NULL,NULL,'en','normal','2018-01-02T03:04:05Z','[]');
CREATE TEMP TABLE legacy_before AS SELECT public.legacy_binder_evidence_v1('03610000-0000-4000-8000-000000000011') evidence;
CREATE TEMP TABLE binder_before AS SELECT to_jsonb(b) value FROM public.binders b WHERE id='03610000-0000-4000-8000-000000000011';

-- Slot-native blank storage never receives an automatic Dex layout or a conversion receipt.
INSERT INTO public.binders(id,owner_user_id,name,is_default) VALUES
 ('03610000-0000-4000-8000-000000000013','03610000-0000-4000-8000-000000000003','Synthetic native blank',true);
INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES
 ('03610000-0000-4000-8000-000000000013','03610000-0000-4000-8000-000000000003','slots');
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.binder_slots WHERE collection_id='03610000-0000-4000-8000-000000000013'),'native blank received targets');
DO $$ BEGIN
 BEGIN PERFORM public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000013','03610000-0000-4000-8000-000000000003','unused');
 RAISE EXCEPTION 'native binder was legacy converted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;

-- Wrong digest and wrong owner leave legacy authoritative with no residue.
DO $$ BEGIN
 BEGIN PERFORM public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001','stale');
 RAISE EXCEPTION 'accepted stale conversion'; EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN PERFORM public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000003','stale');
 RAISE EXCEPTION 'accepted wrong owner'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.storage_collection_state WHERE collection_id='03610000-0000-4000-8000-000000000011'),'failed conversion residue');

-- Malformed legacy wants must leave a usable legacy binder, never commit an unreadable slot snapshot.
DO $$ BEGIN
 BEGIN
 UPDATE public.pokemon_collection SET wanted_cards='[{"unsupported":true}]' WHERE id='03610000-0000-4000-8000-000000000024';
 PERFORM public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',public.legacy_binder_evidence_v1('03610000-0000-4000-8000-000000000011')->>'rowsDigest');
 RAISE EXCEPTION 'unsupported wants accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;

-- Simulated interrupted transaction: conversion succeeds, then subtransaction aborts.
DO $$ BEGIN
 BEGIN
 PERFORM public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',(SELECT evidence->>'rowsDigest' FROM legacy_before));
 RAISE EXCEPTION 'synthetic interruption' USING ERRCODE='ZX001';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $$;
SELECT pg_temp.assert(NOT EXISTS (SELECT 1 FROM public.storage_collection_state WHERE collection_id='03610000-0000-4000-8000-000000000011'),'interruption changed authority');
UPDATE public.pokemon_collection SET pokemon_name=pokemon_name WHERE id='03610000-0000-4000-8000-000000000026';
UPDATE legacy_before SET evidence=public.legacy_binder_evidence_v1('03610000-0000-4000-8000-000000000011');

-- Restore tests omit production ACL/role attributes; establish them only inside this rollback.
ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public,auth TO service_role;
GRANT SELECT,UPDATE ON public.binders TO service_role;
GRANT SELECT ON public.pokemon_collection,legacy_before TO service_role;
SET LOCAL ROLE service_role;
CREATE TEMP TABLE accepted AS SELECT public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',evidence->>'rowsDigest') receipt FROM legacy_before;
RESET ROLE;
SELECT pg_temp.assert((SELECT receipt = public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001','stale retry') FROM accepted),'rerun receipt changed');
SELECT pg_temp.assert((SELECT public.legacy_binder_evidence_v1('03610000-0000-4000-8000-000000000011') = evidence FROM legacy_before),'source rows changed');
SELECT pg_temp.assert((SELECT to_jsonb(b) = (SELECT value FROM binder_before) FROM public.binders b WHERE id='03610000-0000-4000-8000-000000000011'),'binder identity/metadata changed');
SELECT pg_temp.assert((SELECT count(*)=1025 FROM public.binder_slots WHERE collection_id='03610000-0000-4000-8000-000000000011'),'missing implicit targets');
SELECT pg_temp.assert((SELECT count(*)=3 FROM public.inventory_placements WHERE collection_id='03610000-0000-4000-8000-000000000011'),'owned count mismatch');
SELECT pg_temp.assert((SELECT count(*)=2 FROM public.inventory_items WHERE owner_user_id='03610000-0000-4000-8000-000000000001' AND identity->>'cardId'='synthetic-print'),'deduplicated printing');
SELECT pg_temp.assert((SELECT identity='{"kind":"pokemon","pokemonId":3}'::jsonb AND acquired_at IS NULL AND grading IS NULL FROM public.inventory_items WHERE id='03610000-0000-4000-8000-000000000023'),'invented printing/acquisition');
SELECT pg_temp.assert((SELECT s.wanted_cards=m.source_row->'wanted_cards' FROM public.binder_legacy_rows m JOIN public.binder_slots s ON s.id=m.slot_id WHERE m.legacy_row_id='03610000-0000-4000-8000-000000000024'),'lost duplicate wants/person/variant');
SELECT pg_temp.assert((SELECT wanted_cards->0->>'card_id'='synthetic-old-want' FROM public.binder_slots WHERE id=public.legacy_binder_slot_id_v1('03610000-0000-4000-8000-000000000011',5)),'lost pre-wantlist intent');
SELECT pg_temp.assert((SELECT (receipt->>'items')::int=3 AND receipt->'source'->>'rowsDigest'=receipt->>'mappedRowsDigest' FROM accepted),'receipt preservation failed');
SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

-- Uniqueness, cross-owner references, status/placement bijection and safe revision bounds.
DO $$ BEGIN
 BEGIN INSERT INTO public.inventory_placements SELECT * FROM public.inventory_placements WHERE inventory_item_id='03610000-0000-4000-8000-000000000021';
 RAISE EXCEPTION 'duplicate placement accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN UPDATE public.inventory_placements SET owner_user_id='03610000-0000-4000-8000-000000000002' WHERE inventory_item_id='03610000-0000-4000-8000-000000000021';
 SET CONSTRAINTS ALL IMMEDIATE;
 RAISE EXCEPTION 'cross-owner placement accepted'; EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN UPDATE public.binder_slots SET status=NULL WHERE id=public.legacy_binder_slot_id_v1('03610000-0000-4000-8000-000000000011',1);
 SET CONSTRAINTS ALL IMMEDIATE;
 RAISE EXCEPTION 'orphan placement accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.inventory_owner_state SET inventory_revision=9007199254740992 WHERE owner_user_id='03610000-0000-4000-8000-000000000001';
 RAISE EXCEPTION 'overflow accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Three physical copies may share a printing/certificate; graded records stay per item.
INSERT INTO public.inventory_items(id,owner_user_id,identity,grading) VALUES
 ('synthetic-graded-1','03610000-0000-4000-8000-000000000001','{"kind":"card","cardId":"synthetic-print"}',
  '{"provider":{"kind":"known","id":"psa"},"grade":"10","scale":null,"designation":null,"subgrades":[],"certificate":"000123","holder":null,"label":{"variant":null,"assetIds":[]}}'),
 ('synthetic-graded-2','03610000-0000-4000-8000-000000000001','{"kind":"card","cardId":"synthetic-print"}',
  '{"provider":{"kind":"known","id":"psa"},"grade":"9","scale":null,"designation":null,"subgrades":[],"certificate":"000123","holder":null,"label":{"variant":null,"assetIds":[]}}');
SELECT pg_temp.assert((SELECT count(*)=2 FROM public.inventory_items WHERE grading->>'certificate'='000123' AND owner_user_id='03610000-0000-4000-8000-000000000001'),'certificate deduplication');
DELETE FROM public.inventory_items WHERE id IN ('synthetic-graded-1','synthetic-graded-2');



DO $$ BEGIN
 BEGIN UPDATE public.inventory_items SET grading='{"provider":{"kind":"known","id":"invented-provider"}}' WHERE id='03610000-0000-4000-8000-000000000021';
 RAISE EXCEPTION 'invalid grading accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

DO $$ BEGIN
 BEGIN UPDATE public.storage_collection_state SET authority='legacy',conversion_version=NULL,converted_at=NULL,conversion_receipt=NULL
 WHERE collection_id='03610000-0000-4000-8000-000000000011';
 RAISE EXCEPTION 'converted authority downgraded'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN DELETE FROM public.storage_collection_state WHERE collection_id='03610000-0000-4000-8000-000000000011';
 RAISE EXCEPTION 'converted authority erased'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;

-- Converted rows cannot be written even using service/admin SQL. Old untouched binders remain writable.
DO $$ BEGIN
 BEGIN UPDATE public.pokemon_collection SET card_id='changed' WHERE id='03610000-0000-4000-8000-000000000021';
 RAISE EXCEPTION 'legacy update accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN DELETE FROM public.pokemon_collection WHERE id='03610000-0000-4000-8000-000000000021';
 RAISE EXCEPTION 'legacy delete accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN INSERT INTO public.pokemon_collection(binder_id,user_id,pokemon_id,pokemon_name) VALUES ('03610000-0000-4000-8000-000000000011','03610000-0000-4000-8000-000000000001',99,'Synthetic rejected');
 RAISE EXCEPTION 'legacy insert accepted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $$;
-- Empty binder conversion: no owned item or saved-card charge, still 1025 targets.
SELECT public.convert_legacy_binder_v1('03610000-0000-4000-8000-000000000012','03610000-0000-4000-8000-000000000002',public.legacy_binder_evidence_v1('03610000-0000-4000-8000-000000000012')->>'rowsDigest');
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.inventory_items WHERE owner_user_id='03610000-0000-4000-8000-000000000002'),'empty targets created inventory');

-- Exercise actual private RLS, including the existing billing predicate.
INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES ('03610000-0000-4000-8000-000000000001','manual');
INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ('03610000-0000-4000-8000-000000000001','03610000-0000-4000-8000-000000000003','03610000-0000-4000-8000-000000000001');
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT ON public.partnerships TO authenticated;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"03610000-0000-4000-8000-000000000001","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','03610000-0000-4000-8000-000000000001',true);
SELECT pg_temp.assert((SELECT count(*)=1025 FROM public.binder_slots WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'owner RLS');
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.binder_slots WHERE owner_user_id='03610000-0000-4000-8000-000000000002'),'stranger RLS');
SELECT pg_temp.assert(NOT has_table_privilege('authenticated','public.inventory_items','INSERT') AND NOT has_function_privilege('authenticated','public.convert_legacy_binder_v1(uuid,uuid,text)','EXECUTE'),'client mutation exposed');
SELECT set_config('request.jwt.claims','{"sub":"03610000-0000-4000-8000-000000000003","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','03610000-0000-4000-8000-000000000003',true);
SELECT pg_temp.assert((SELECT count(*)=1025 FROM public.binder_slots WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'partner/billing RLS');
RESET ROLE;
UPDATE public.billing_configuration SET enforced=true WHERE id;
DELETE FROM public.perpetual_licences WHERE owner_user_id='03610000-0000-4000-8000-000000000001';
UPDATE auth.users SET created_at='2000-01-01T00:00:00Z' WHERE id='03610000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.binder_slots WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'unentitled partner retained access');
RESET ROLE;
INSERT INTO public.perpetual_licences(owner_user_id,source) VALUES ('03610000-0000-4000-8000-000000000001','manual');
DELETE FROM public.partnerships WHERE owner_user_id='03610000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.inventory_items WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'unlink retained access');
RESET ROLE;
SELECT pg_temp.assert(NOT has_table_privilege('anon','public.binder_slots','SELECT'),'anon access');

EXPLAIN (ANALYZE, BUFFERS) SELECT id,position FROM public.binder_slots WHERE collection_id='03610000-0000-4000-8000-000000000011' ORDER BY position,id LIMIT 1000;
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.inventory_items WHERE owner_user_id='03610000-0000-4000-8000-000000000001' ORDER BY id LIMIT 1000;

-- Collection deletion removes placements, preserves physical ownership and original source metadata.
DELETE FROM public.binders WHERE id='03610000-0000-4000-8000-000000000011';
SET CONSTRAINTS ALL IMMEDIATE;
SELECT pg_temp.assert((SELECT count(*)=3 FROM public.inventory_items WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'collection cascade deleted inventory');
SELECT pg_temp.assert((SELECT count(*)=0 FROM public.inventory_placements WHERE owner_user_id='03610000-0000-4000-8000-000000000001'),'collection cascade retained placements');
ROLLBACK;
