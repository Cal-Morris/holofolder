-- Synthetic transaction checks; run only against the task-owned scratch database.
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002'), ('00000000-0000-4000-8000-000000000003');
INSERT INTO public.pokemon_collection(user_id,pokemon_id,pokemon_name,card_id,card_name,status,card_finish,card_language,wanted_cards)
VALUES ('00000000-0000-4000-8000-000000000001',1,'Fixture','fixture-1','Fixture card','collected','normal','en','[]');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 1 THEN RAISE EXCEPTION 'insert not recorded'; END IF;
END $$;
UPDATE public.pokemon_collection SET status='finalized';
UPDATE public.pokemon_collection SET card_name='Fixture card renamed';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 1 THEN RAISE EXCEPTION 'favourite/no-op logged as acquisition'; END IF;
END $$;
UPDATE public.pokemon_collection SET card_id='fixture-2', card_name='Replacement';
UPDATE public.pokemon_collection SET wanted_cards='[{"card_id":"fixture-want","card_name":"Fixture wanted","card_language":"en","card_finish":"normal","added_at":"2026-01-01T00:00:00Z"}]';
UPDATE public.pokemon_collection SET wanted_cards='[{"card_id":"fixture-want","card_name":"Renamed want","card_language":"en","card_finish":"normal","added_at":"2026-10-11T00:00:00Z"}]';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 3 THEN RAISE EXCEPTION 'identity changes/no-op incorrect'; END IF;
END $$;
INSERT INTO public.card_prices(card_id,language,market_gbp_amount,source,confidence,source_updated_at,finish_prices)
VALUES ('fixture-2','en',12,'cardmarket','high',now(),'[{"finish":"normal","variantKey":"normal","source":"cardmarket","marketGbpAmount":12,"confidence":"high","updatedAt":"2026-10-11T12:00:00Z"}]'),
('fixture-untracked','en',10,'cardmarket','high',now(),'[]');
UPDATE public.card_prices SET market_gbp_amount=13 WHERE card_id='fixture-2';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.card_price_history) <> 1 THEN RAISE EXCEPTION 'daily dedup or tracked gate failed'; END IF;
END $$;
-- Invalid/missing quote amounts must never abort normal price writes.
UPDATE public.card_prices SET finish_prices='[{"finish":"normal","variantKey":"normal","source":"cardmarket","confidence":"high"}]' WHERE card_id='fixture-2';
UPDATE public.card_prices SET finish_prices='[{"finish":"normal","variantKey":"normal","source":"cardmarket","marketGbpAmount":0,"confidence":"high"}]' WHERE card_id='fixture-2';
INSERT INTO public.card_price_history(card_id,language,finish,variant_key,source,observed_day,gbp_amount,confidence) VALUES ('fixture-expired','en','normal','normal','cardmarket',CURRENT_DATE-90,1,'high');
UPDATE public.card_prices SET finish_prices='[]' WHERE card_id='fixture-2';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.card_price_history WHERE card_id='fixture-expired') THEN RAISE EXCEPTION '90 day retention failed'; END IF;
END $$;
-- Newly tracked cards capture an existing cache observation, without backdating it.
INSERT INTO public.card_prices(card_id,language,market_gbp_amount,source,confidence,source_updated_at,finish_prices) VALUES ('fixture-new','en',5,'cardmarket','high',now(),'[{"finish":"normal","variantKey":"normal","source":"cardmarket","marketGbpAmount":5,"confidence":"high"}]');
UPDATE public.pokemon_collection SET wanted_cards=wanted_cards || '[{"card_id":"fixture-new","card_name":"Fixture new"}]'::jsonb;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.card_price_history WHERE card_id='fixture-new' AND observed_day=CURRENT_DATE) THEN RAISE EXCEPTION 'newly tracked cache not recorded'; END IF;
END $$;
INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 4 THEN RAISE EXCEPTION 'partner cannot read'; END IF;
  BEGIN INSERT INTO public.collection_activity(owner_user_id,pokemon_id,pokemon_name) VALUES ('00000000-0000-4000-8000-000000000002',1,'Forge'); RAISE EXCEPTION 'client can forge events'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 0 THEN RAISE EXCEPTION 'outsider saw private activity'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.collection_activity; RAISE EXCEPTION 'anonymous read allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM 1 FROM public.card_price_history; RAISE EXCEPTION 'anonymous history allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
DELETE FROM public.pokemon_collection;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 5 THEN RAISE EXCEPTION 'removal not recorded'; END IF;
END $$;
ROLLBACK;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.collection_activity) <> 0 THEN RAISE EXCEPTION 'rolled back activity survived'; END IF;
END $$;

BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002'),('00000000-0000-4000-8000-000000000003');
INSERT INTO public.partner_invites(inviter_id,invitee_email,status) VALUES ('00000000-0000-4000-8000-000000000001','recipient@fixture.test','pending');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"email":"recipient@fixture.test"}',true);
DO $$ BEGIN
  BEGIN INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'forged partnership allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.partner_invites SET inviter_id='00000000-0000-4000-8000-000000000003'; RAISE EXCEPTION 'invite owner mutation allowed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001') ON CONFLICT(user1_id,user2_id) DO UPDATE SET user1_id=EXCLUDED.user1_id,user2_id=EXCLUDED.user2_id,owner_user_id=EXCLUDED.owner_user_id;
UPDATE public.partner_invites SET status='accepted';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.partnerships) <> 1 OR NOT EXISTS(SELECT 1 FROM public.partner_invites WHERE status='accepted') THEN RAISE EXCEPTION 'legitimate recipient blocked'; END IF;
END $$;
ROLLBACK;

BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
INSERT INTO public.partner_invites(inviter_id,invitee_email,status) VALUES ('00000000-0000-4000-8000-000000000001','recipient@fixture.test','accepted');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"email":"recipient@fixture.test"}',true);
UPDATE public.partner_invites SET status='pending';
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.partner_invites WHERE status='pending') THEN RAISE EXCEPTION 'accepted invite reset'; END IF;
  BEGIN INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'removed partner reused consent'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
ROLLBACK;
