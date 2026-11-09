-- Additive storage only. No binder is converted by applying this file.
-- Apply as ONE transaction. The tables are new/empty, so their indexes need no CONCURRENTLY.
-- No new authenticated write surface: #362/#383/#394 own commands, authorization and audit.
BEGIN;
SET LOCAL lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.inventory_owner_state (
  owner_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  inventory_revision bigint NOT NULL DEFAULT 0 CHECK (inventory_revision BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE IF NOT EXISTS public.storage_collection_state (
  collection_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'binder' CHECK (kind IN ('binder','slab','custom')),
  default_presentation text NOT NULL DEFAULT 'binder' CHECK (default_presentation IN ('binder','slabs','list')),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  layout_revision bigint NOT NULL DEFAULT 0 CHECK (layout_revision BETWEEN 0 AND 9007199254740991),
  preset_manifest jsonb CHECK (preset_manifest IS NULL OR jsonb_typeof(preset_manifest) = 'object'),
  authority text NOT NULL DEFAULT 'legacy' CHECK (authority IN ('legacy','slots')),
  conversion_version integer,
  converted_at timestamptz,
  conversion_receipt jsonb,
  UNIQUE (collection_id, owner_user_id),
  FOREIGN KEY (collection_id, owner_user_id) REFERENCES public.binders(id, owner_user_id) ON DELETE CASCADE,
  CHECK ((authority = 'legacy' AND conversion_version IS NULL AND converted_at IS NULL AND conversion_receipt IS NULL)
    OR (authority = 'slots' AND ((conversion_version IS NULL AND converted_at IS NULL AND conversion_receipt IS NULL)
      OR (conversion_version IS NOT NULL AND conversion_version = 1 AND converted_at IS NOT NULL AND conversion_receipt IS NOT NULL))))
);
CREATE INDEX IF NOT EXISTS storage_collection_state_owner ON public.storage_collection_state(owner_user_id, collection_id);

-- JSON identities use the exact #382 shape. No catalog FK: historical unknown/deleted printings survive.
CREATE OR REPLACE FUNCTION public.valid_inventory_identity_v1(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT coalesce(jsonb_typeof(value) = 'object' AND CASE value->>'kind'
 WHEN 'pokemon' THEN (value - 'kind' - 'pokemonId' = '{}'::jsonb
   AND jsonb_typeof(value->'pokemonId') = 'number' AND (value->>'pokemonId') ~ '^[1-9][0-9]*$'
   AND (value->>'pokemonId')::numeric <= 9007199254740991)
 WHEN 'card' THEN (value - 'kind' - 'cardId' - 'language' - 'finish' = '{}'::jsonb
   AND jsonb_typeof(value->'cardId') = 'string' AND length(value->>'cardId') BETWEEN 1 AND 200
   AND btrim(value->>'cardId') = value->>'cardId'
   AND (NOT value ? 'language' OR value->>'language' IN ('en','fr','de','es','it','pt-br','ja','ko'))
   AND (NOT value ? 'finish' OR value->>'finish' IN ('normal','holo','reverse_holo','double_rare','ultra_rare','illustration_rare','special_illustration_rare','secret_rare','hyper_rare','radiant_rare','ace_spec','amazing_rare','shiny_rare','jumbo')))
 ELSE false END, false)
$$;
-- Exact #382 grading shape. Recorded text only, no grade/certificate uniqueness or numeric inference.
CREATE OR REPLACE FUNCTION public.valid_grading_record_v1(value jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE provider jsonb; label jsonb; part jsonb; field text;
BEGIN
 IF value IS NULL THEN RETURN true; END IF;
 IF jsonb_typeof(value) <> 'object' OR value - ARRAY['provider','grade','scale','designation','subgrades','certificate','holder','label'] <> '{}'::jsonb
   OR NOT value ?& ARRAY['provider','grade','scale','designation','subgrades','certificate','holder','label'] THEN RETURN false; END IF;
 FOREACH field IN ARRAY ARRAY['grade','scale','designation','certificate','holder'] LOOP
   IF value->field <> 'null'::jsonb AND (jsonb_typeof(value->field) <> 'string' OR length(value->>field) > 500 OR length(btrim(value->>field)) = 0) THEN RETURN false; END IF;
 END LOOP;
 provider := value->'provider'; label := value->'label';
 IF jsonb_typeof(provider) <> 'object' OR jsonb_typeof(label) <> 'object'
   OR label - ARRAY['variant','assetIds'] <> '{}'::jsonb OR NOT label ?& ARRAY['variant','assetIds'] THEN RETURN false; END IF;
 IF provider->>'kind' = 'known' THEN
   IF provider - ARRAY['kind','id'] <> '{}'::jsonb OR NOT coalesce(provider->>'id' IN ('psa','ace','cgc','beckett'),false) THEN RETURN false; END IF;
 ELSIF provider->>'kind' = 'custom' THEN
   IF provider - ARRAY['kind','name'] <> '{}'::jsonb OR jsonb_typeof(provider->'name') IS DISTINCT FROM 'string'
     OR length(btrim(provider->>'name')) = 0 OR length(provider->>'name') > 500 THEN RETURN false; END IF;
 ELSE RETURN false; END IF;
 IF label->'variant' <> 'null'::jsonb AND (jsonb_typeof(label->'variant') <> 'string'
   OR length(btrim(label->>'variant')) = 0 OR length(label->>'variant') > 500) THEN RETURN false; END IF;
 IF jsonb_typeof(value->'subgrades') <> 'array' OR jsonb_typeof(label->'assetIds') <> 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(value->'subgrades') > 20 OR jsonb_array_length(label->'assetIds') > 20 THEN RETURN false; END IF;
 FOR part IN SELECT jsonb_array_elements(value->'subgrades') LOOP
   IF jsonb_typeof(part) <> 'object' OR part - ARRAY['name','grade'] <> '{}'::jsonb OR NOT part ?& ARRAY['name','grade'] THEN RETURN false; END IF;
   FOREACH field IN ARRAY ARRAY['name','grade'] LOOP
     IF jsonb_typeof(part->field) <> 'string' OR length(btrim(part->>field)) = 0 OR length(part->>field) > 500 THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 FOR part IN SELECT jsonb_array_elements(label->'assetIds') LOOP
   IF jsonb_typeof(part) <> 'string' OR length(part #>> '{}') NOT BETWEEN 1 AND 200
     OR btrim(part #>> '{}') <> part #>> '{}' THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200 AND id = btrim(id)),
  owner_user_id uuid NOT NULL REFERENCES public.inventory_owner_state(owner_user_id) ON DELETE CASCADE,
  identity jsonb NOT NULL CHECK (public.valid_inventory_identity_v1(identity)),
  grading jsonb CHECK (grading IS NULL OR (identity->>'kind' = 'card' AND public.valid_grading_record_v1(grading))),
  acquired_at timestamptz,
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Immutable import evidence, not a second mutable card payload or an audit feed.
  legacy_source jsonb,
  UNIQUE (id, owner_user_id)
);
CREATE INDEX IF NOT EXISTS inventory_items_owner_id ON public.inventory_items(owner_user_id, id);
CREATE OR REPLACE FUNCTION public.valid_slot_wants_v1(value jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE want jsonb; field text; person jsonb; identity_value jsonb;
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 FOR want IN SELECT jsonb_array_elements(value) LOOP
   IF jsonb_typeof(want) <> 'object' OR want - ARRAY['card_id','card_name','added_at','card_image','card_set','rarity','local_id','illustrator','set_total','card_language','card_finish','wanted_by'] <> '{}'::jsonb
     OR NOT want ?& ARRAY['card_id','card_name','added_at'] THEN RETURN false; END IF;
   IF jsonb_typeof(want->'card_name') <> 'string' OR length(btrim(want->>'card_name')) = 0
     OR jsonb_typeof(want->'added_at') <> 'string'
     OR (want->>'added_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}($|[T ][0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}(:[0-9]{2})?)$)' THEN RETURN false; END IF;
   BEGIN PERFORM (want->>'added_at')::timestamptz;
   EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false; END;
   IF lower(want->>'added_at') IN ('infinity','-infinity') THEN RETURN false; END IF;
   identity_value := jsonb_build_object('kind','card','cardId',want->'card_id');
   IF want ? 'card_language' THEN identity_value := identity_value || jsonb_build_object('language',want->'card_language'); END IF;
   IF want ? 'card_finish' THEN identity_value := identity_value || jsonb_build_object('finish',want->'card_finish'); END IF;
   IF NOT public.valid_inventory_identity_v1(identity_value) THEN RETURN false; END IF;
   FOREACH field IN ARRAY ARRAY['card_image','card_set','rarity','local_id','illustrator'] LOOP
     IF want ? field AND jsonb_typeof(want->field) <> 'string' THEN RETURN false; END IF;
   END LOOP;
   IF want ? 'set_total' THEN
     IF jsonb_typeof(want->'set_total') <> 'number' OR (want->>'set_total') !~ '^[1-9][0-9]*$'
       OR (want->>'set_total')::numeric > 9007199254740991 THEN RETURN false; END IF;
   END IF;
   IF want ? 'wanted_by' THEN
     IF jsonb_typeof(want->'wanted_by') <> 'array' THEN RETURN false; END IF;
     IF jsonb_array_length(want->'wanted_by') > 2 THEN RETURN false; END IF;
     FOR person IN SELECT jsonb_array_elements(want->'wanted_by') LOOP
       IF jsonb_typeof(person) <> 'string' OR (person #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
     END LOOP;
     IF (SELECT count(DISTINCT lower(p #>> '{}')) FROM jsonb_array_elements(want->'wanted_by') p) <> jsonb_array_length(want->'wanted_by') THEN RETURN false; END IF;
   END IF;
 END LOOP;
 RETURN true;
END $$;

CREATE TABLE IF NOT EXISTS public.binder_slots (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200 AND id = btrim(id)),
  collection_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  position bigint NOT NULL CHECK (position BETWEEN 0 AND 9007199254740991),
  target jsonb CHECK (target IS NULL OR public.valid_inventory_identity_v1(target)),
  status text CHECK (status IN ('collected','finalized','considering','wishlisted')),
  wanted_cards jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (public.valid_slot_wants_v1(wanted_cards)),
  preset_origin jsonb CHECK (preset_origin IS NULL OR jsonb_typeof(preset_origin) = 'object'),
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, collection_id, owner_user_id),
  UNIQUE (collection_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (collection_id, owner_user_id) REFERENCES public.storage_collection_state(collection_id, owner_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS binder_slots_owner_collection ON public.binder_slots(owner_user_id, collection_id);
CREATE TABLE IF NOT EXISTS public.inventory_placements (
  inventory_item_id text PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  collection_id uuid NOT NULL,
  slot_id text NOT NULL UNIQUE,
  version bigint NOT NULL DEFAULT 0 CHECK (version BETWEEN 0 AND 9007199254740991),
  FOREIGN KEY (inventory_item_id, owner_user_id) REFERENCES public.inventory_items(id, owner_user_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (slot_id, collection_id, owner_user_id) REFERENCES public.binder_slots(id, collection_id, owner_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS inventory_placements_collection ON public.inventory_placements(collection_id, slot_id);
CREATE INDEX IF NOT EXISTS inventory_placements_owner ON public.inventory_placements(owner_user_id, inventory_item_id);
CREATE TABLE IF NOT EXISTS public.binder_legacy_rows (
  legacy_row_id uuid PRIMARY KEY,
  collection_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  slot_id text NOT NULL UNIQUE,
  source_row jsonb NOT NULL CHECK (jsonb_typeof(source_row) = 'object'),
  FOREIGN KEY (slot_id, collection_id, owner_user_id) REFERENCES public.binder_slots(id, collection_id, owner_user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS binder_legacy_rows_collection ON public.binder_legacy_rows(collection_id, legacy_row_id);
CREATE INDEX IF NOT EXISTS binder_legacy_rows_owner ON public.binder_legacy_rows(owner_user_id, legacy_row_id);

-- Preserve the owned-status/placement bijection at transaction end, permitting atomic moves.
CREATE OR REPLACE FUNCTION public.check_slot_placement_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE slot_key text; slot_keys text[];
BEGIN
 IF TG_TABLE_NAME = 'binder_slots' THEN
   IF TG_OP = 'DELETE' THEN slot_keys := ARRAY[OLD.id];
   ELSIF TG_OP = 'INSERT' THEN slot_keys := ARRAY[NEW.id];
   ELSE slot_keys := ARRAY[OLD.id,NEW.id]; END IF;
 ELSE
   IF TG_OP = 'DELETE' THEN slot_keys := ARRAY[OLD.slot_id];
   ELSIF TG_OP = 'INSERT' THEN slot_keys := ARRAY[NEW.slot_id];
   ELSE slot_keys := ARRAY[OLD.slot_id,NEW.slot_id]; END IF;
 END IF;
 FOREACH slot_key IN ARRAY slot_keys LOOP
   IF EXISTS (SELECT 1 FROM public.binder_slots s JOIN public.storage_collection_state c ON c.collection_id = s.collection_id
     WHERE s.id = slot_key AND c.authority <> 'slots') THEN
     RAISE EXCEPTION 'Legacy binder cannot commit slot contents' USING ERRCODE = '23514';
   END IF;
   IF EXISTS (SELECT 1 FROM public.binder_slots s WHERE s.id = slot_key
     AND (coalesce(s.status IN ('collected','finalized'),false) IS DISTINCT FROM
       EXISTS (SELECT 1 FROM public.inventory_placements p WHERE p.slot_id = s.id))) THEN
     RAISE EXCEPTION 'Slot ownership requires exactly one placement' USING ERRCODE = '23514';
   END IF;
 END LOOP;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS slot_placement_consistency ON public.binder_slots;
CREATE CONSTRAINT TRIGGER slot_placement_consistency AFTER INSERT OR UPDATE OR DELETE ON public.binder_slots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_slot_placement_v1();
DROP TRIGGER IF EXISTS placement_slot_consistency ON public.inventory_placements;
CREATE CONSTRAINT TRIGGER placement_slot_consistency AFTER INSERT OR UPDATE OR DELETE ON public.inventory_placements
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_slot_placement_v1();

-- Same owner/partner and billing boundaries as the existing private collection. No public share access.
DO $$
DECLARE table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['inventory_owner_state','storage_collection_state','inventory_items','binder_slots','inventory_placements','binder_legacy_rows'] LOOP
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',table_name);
   EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,holo_mcp',table_name);
   EXECUTE format('GRANT SELECT ON public.%I TO authenticated',table_name);
   EXECUTE format('GRANT ALL ON public.%I TO service_role',table_name);
   EXECUTE format('DROP POLICY IF EXISTS storage_owner_partner_read ON public.%I',table_name);
   EXECUTE format('CREATE POLICY storage_owner_partner_read ON public.%I FOR SELECT TO authenticated USING (
     (owner_user_id = (select auth.uid()) OR owner_user_id IN (
       SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())))
     AND public.billing_partner_allowed(owner_user_id,(select auth.uid())))',table_name);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.legacy_binder_slot_id_v1(collection uuid, species integer) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
 SELECT 'legacy-dex-v1/' || collection::text || '/' || species::text
$$;

-- Once handed over, conversion evidence and authority cannot be reset by a stale service command.
CREATE OR REPLACE FUNCTION public.guard_storage_authority_v1() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   IF OLD.authority = 'slots' AND EXISTS (SELECT 1 FROM public.binders WHERE id = OLD.collection_id) THEN
     RAISE EXCEPTION 'Slot authority can only be removed with its collection' USING ERRCODE = '55000';
   END IF;
   RETURN OLD;
 END IF;
 IF OLD.authority = 'slots' AND (NEW.authority IS DISTINCT FROM OLD.authority
   OR NEW.conversion_version IS DISTINCT FROM OLD.conversion_version
   OR NEW.converted_at IS DISTINCT FROM OLD.converted_at
   OR NEW.conversion_receipt IS DISTINCT FROM OLD.conversion_receipt) THEN
   RAISE EXCEPTION 'Converted storage requires version-safe recovery' USING ERRCODE = '55000';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS storage_authority_guard ON public.storage_collection_state;
CREATE TRIGGER storage_authority_guard BEFORE UPDATE OR DELETE ON public.storage_collection_state
 FOR EACH ROW EXECUTE FUNCTION public.guard_storage_authority_v1();

-- Synchronize legacy writers with conversion on the existing binder row. Cover both sides of reparenting.
-- Alphabetically after assign_binder, before timestamp triggers. No client-settable bypass flag.
CREATE OR REPLACE FUNCTION public.guard_legacy_binder_write_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE binder_keys uuid[]; key uuid;
BEGIN
 IF TG_OP = 'INSERT' THEN binder_keys := ARRAY[NEW.binder_id];
 ELSIF TG_OP = 'DELETE' THEN binder_keys := ARRAY[OLD.binder_id];
 ELSE binder_keys := ARRAY[OLD.binder_id,NEW.binder_id]; END IF;
 FOR key IN SELECT DISTINCT k FROM unnest(binder_keys) k ORDER BY k LOOP
   PERFORM 1 FROM public.binders WHERE id = key FOR UPDATE;
   -- During parent binder deletion, cascades remove the frozen legacy snapshot too.
   IF FOUND AND EXISTS (SELECT 1 FROM public.storage_collection_state WHERE collection_id = key AND authority = 'slots') THEN
     RAISE EXCEPTION 'binder_converted_requires_slot_commands' USING ERRCODE = '55000';
   END IF;
 END LOOP;
 IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
DROP TRIGGER IF EXISTS pokemon_collection_guard_slots ON public.pokemon_collection;
CREATE TRIGGER pokemon_collection_guard_slots BEFORE INSERT OR UPDATE OR DELETE ON public.pokemon_collection
 FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_binder_write_v1();

-- A row-stream digest, not a count-only check. Includes every source field, duplicate want, person and timestamp.
CREATE OR REPLACE FUNCTION public.legacy_binder_evidence_v1(collection uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' SET TimeZone = 'UTC' AS $$
 SELECT jsonb_build_object('rows',count(*),'owned',count(*) FILTER (WHERE c.status IN ('collected','finalized')),
   'wantedEntries',coalesce(sum(jsonb_array_length(c.wanted_cards)),0),
   'rowsDigest',md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' ORDER BY c.id),'')),
   'ownedDigest',md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' ORDER BY c.id) FILTER (WHERE c.status IN ('collected','finalized')),'')),
   'wantedDigest',md5(coalesce(string_agg(md5(to_jsonb(c)::text),'' ORDER BY c.id) FILTER (WHERE c.status = 'wishlisted' OR c.wanted_cards <> '[]'::jsonb),'')))
 FROM public.pokemon_collection c WHERE c.binder_id = collection
$$;

-- Legacy null/zero display hints mean unknown in the strict contract. Retain originals in
-- binder_legacy_rows.source_row; omit only these hints from the editable wanted choice.
CREATE OR REPLACE FUNCTION public.legacy_binder_wants_v1(row_value public.pokemon_collection) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE result jsonb := '[]'; want jsonb; field text; source jsonb := row_value.wanted_cards;
BEGIN
 IF row_value.status = 'wishlisted' AND row_value.card_id IS NOT NULL AND source = '[]'::jsonb THEN
   source := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('card_id',row_value.card_id,'card_name',row_value.card_name,
     'card_image',row_value.card_image,'card_set',row_value.card_set,'card_language',row_value.card_language,
     'card_finish',row_value.card_finish,'added_at',row_value.collected_at)));
 END IF;
 FOR want IN SELECT jsonb_array_elements(source) LOOP
   FOREACH field IN ARRAY ARRAY['card_image','card_set','rarity','local_id','illustrator','set_total','card_language','card_finish','wanted_by'] LOOP
     IF want->field = 'null'::jsonb THEN want := want - field; END IF;
   END LOOP;
   IF want->'set_total' = '0'::jsonb THEN want := want - 'set_total'; END IF;
   result := result || jsonb_build_array(want);
 END LOOP;
 RETURN result;
END $$;

-- Explicit service-only primitive. Never invoked by the migration, requests or background jobs here.
-- #362/#383 must wrap invocation with trusted owner/actor, entitlement and #394 transactional recording.
CREATE OR REPLACE FUNCTION public.convert_legacy_binder_v1(collection uuid, expected_owner uuid, expected_rows_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET TimeZone = 'UTC' AS $$
DECLARE owner_id uuid; evidence jsonb; receipt jsonb; mapped_digest text; mapped_owned_digest text; mapped_wanted_digest text; mapped_wants bigint; item_count bigint; copied_wants bigint;
BEGIN
 SELECT b.owner_user_id INTO owner_id FROM public.binders b WHERE b.id = collection;
 IF owner_id IS NULL OR owner_id IS DISTINCT FROM expected_owner THEN
   RAISE EXCEPTION 'Binder owner changed' USING ERRCODE = '42501';
 END IF;
 -- Owner lock serializes inventory revision and distinct-binder conversion for this owner.
 INSERT INTO public.inventory_owner_state(owner_user_id) VALUES (owner_id) ON CONFLICT DO NOTHING;
 PERFORM 1 FROM public.inventory_owner_state WHERE owner_user_id = owner_id FOR UPDATE;
 PERFORM 1 FROM public.binders b WHERE b.id = collection AND b.owner_user_id = owner_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Binder owner changed' USING ERRCODE = '42501'; END IF;
 SELECT conversion_receipt INTO receipt FROM public.storage_collection_state WHERE collection_id = collection AND authority = 'slots';
 IF FOUND THEN
   IF receipt IS NULL THEN RAISE EXCEPTION 'Slot-native binder cannot be legacy-converted' USING ERRCODE = '55000'; END IF;
   RETURN receipt;
 END IF;
 evidence := public.legacy_binder_evidence_v1(collection);
 IF expected_rows_digest IS NULL OR evidence->>'rowsDigest' IS DISTINCT FROM expected_rows_digest THEN
   RAISE EXCEPTION 'Legacy binder changed, preview again' USING ERRCODE = '40001';
 END IF;
 IF EXISTS (SELECT 1 FROM public.pokemon_collection c WHERE c.binder_id = collection
   AND (c.pokemon_id NOT BETWEEN 1 AND 1025 OR c.user_id <> owner_id OR jsonb_typeof(c.wanted_cards) <> 'array'
     OR NOT public.valid_slot_wants_v1(public.legacy_binder_wants_v1(c))
     OR (c.status = 'wishlisted' AND c.card_id IS NOT NULL AND c.wanted_cards = '[]'::jsonb AND (c.collected_at IS NULL OR c.card_name IS NULL)))) THEN
   RAISE EXCEPTION 'Unsupported legacy row, retain legacy authority and repair explicitly' USING ERRCODE = '22023';
 END IF;
 INSERT INTO public.storage_collection_state(collection_id,owner_user_id) VALUES (collection,owner_id)
 ON CONFLICT (collection_id) DO NOTHING;
 -- No ON CONFLICT for contents: partial/manual residue conflicts instead of overwriting copies or edits.
 INSERT INTO public.binder_slots(id,collection_id,owner_user_id,position,target,status,wanted_cards,preset_origin,created_at,updated_at)
 SELECT public.legacy_binder_slot_id_v1(collection,n),collection,owner_id,n-1,jsonb_build_object('kind','pokemon','pokemonId',n),
   c.status,CASE WHEN c.id IS NULL THEN '[]'::jsonb ELSE public.legacy_binder_wants_v1(c) END,
   jsonb_build_object('source',jsonb_build_object('id','national-dex','version','legacy-v1'),'entryId',n::text),
   coalesce(c.collected_at,b.created_at),coalesce(c.updated_at,b.created_at)
 FROM generate_series(1,1025) n JOIN public.binders b ON b.id = collection
 LEFT JOIN public.pokemon_collection c ON c.binder_id = collection AND c.pokemon_id = n;
 INSERT INTO public.binder_legacy_rows(legacy_row_id,collection_id,owner_user_id,slot_id,source_row)
 SELECT c.id,collection,owner_id,public.legacy_binder_slot_id_v1(collection,c.pokemon_id),to_jsonb(c)
 FROM public.pokemon_collection c WHERE c.binder_id = collection;
 INSERT INTO public.inventory_items(id,owner_user_id,identity,grading,acquired_at,created_at,updated_at,legacy_source)
 SELECT c.id::text,owner_id,CASE WHEN c.card_id IS NULL THEN jsonb_build_object('kind','pokemon','pokemonId',c.pokemon_id)
   ELSE jsonb_build_object('kind','card','cardId',c.card_id,'language',c.card_language,'finish',c.card_finish) END,
   NULL,c.collected_at,coalesce(c.collected_at,b.created_at),c.updated_at,to_jsonb(c)
 FROM public.pokemon_collection c JOIN public.binders b ON b.id = c.binder_id
 WHERE c.binder_id = collection AND c.status IN ('collected','finalized');
 INSERT INTO public.inventory_placements(inventory_item_id,owner_user_id,collection_id,slot_id)
 SELECT c.id::text,owner_id,collection,public.legacy_binder_slot_id_v1(collection,c.pokemon_id)
 FROM public.pokemon_collection c WHERE c.binder_id = collection AND c.status IN ('collected','finalized');
 SELECT md5(coalesce(string_agg(md5(source_row::text),'' ORDER BY legacy_row_id),'')),
   md5(coalesce(string_agg(md5(source_row::text),'' ORDER BY legacy_row_id) FILTER (WHERE source_row->>'status' IN ('collected','finalized')),'')),
   md5(coalesce(string_agg(md5(source_row::text),'' ORDER BY legacy_row_id) FILTER (WHERE source_row->>'status' = 'wishlisted' OR source_row->'wanted_cards' <> '[]'::jsonb),'')),
   coalesce(sum(jsonb_array_length(source_row->'wanted_cards')),0)
 INTO mapped_digest,mapped_owned_digest,mapped_wanted_digest,mapped_wants
 FROM public.binder_legacy_rows WHERE collection_id = collection;
 SELECT count(*) INTO item_count FROM public.inventory_placements WHERE collection_id = collection;
 SELECT coalesce(sum(jsonb_array_length(wanted_cards)),0) INTO copied_wants FROM public.binder_slots WHERE collection_id = collection;
 IF EXISTS (SELECT 1 FROM public.pokemon_collection c
   JOIN public.binder_slots s ON s.id = public.legacy_binder_slot_id_v1(collection,c.pokemon_id)
   LEFT JOIN public.inventory_items i ON i.id = c.id::text
   WHERE c.binder_id = collection AND (s.wanted_cards IS DISTINCT FROM public.legacy_binder_wants_v1(c)
     OR s.status IS DISTINCT FROM c.status OR (c.status IN ('collected','finalized') AND
       (i.legacy_source IS DISTINCT FROM to_jsonb(c) OR i.acquired_at IS DISTINCT FROM c.collected_at
        OR i.identity IS DISTINCT FROM CASE WHEN c.card_id IS NULL THEN jsonb_build_object('kind','pokemon','pokemonId',c.pokemon_id)
          ELSE jsonb_build_object('kind','card','cardId',c.card_id,'language',c.card_language,'finish',c.card_finish) END)))) THEN
   RAISE EXCEPTION 'Legacy content mapping mismatch' USING ERRCODE = '23514';
 END IF;
 IF mapped_digest IS DISTINCT FROM evidence->>'rowsDigest' OR item_count <> (evidence->>'owned')::bigint
   OR mapped_owned_digest IS DISTINCT FROM evidence->>'ownedDigest' OR mapped_wanted_digest IS DISTINCT FROM evidence->>'wantedDigest'
   OR mapped_wants <> (evidence->>'wantedEntries')::bigint THEN
   RAISE EXCEPTION 'Legacy preservation mismatch' USING ERRCODE = '23514';
 END IF;
 receipt := jsonb_build_object('version',1,'collectionId',collection,'ownerUserId',owner_id,'source',evidence,
   'mappedRowsDigest',mapped_digest,'mappedOwnedDigest',mapped_owned_digest,'mappedWantedDigest',mapped_wanted_digest,'mappedWantedEntries',mapped_wants,'items',item_count,'placements',item_count,'slots',1025,'copiedWantedEntries',copied_wants);
 UPDATE public.storage_collection_state SET authority = 'slots',conversion_version = 1,converted_at = now(),conversion_receipt = receipt,
   preset_manifest = jsonb_build_object('source',jsonb_build_object('id','national-dex','version','legacy-v1'),'name','National Dex',
     'entries',(SELECT jsonb_agg(jsonb_build_object('id',n::text,'target',jsonb_build_object('kind','pokemon','pokemonId',n)) ORDER BY n) FROM generate_series(1,1025) n))
 WHERE collection_id = collection;
 UPDATE public.inventory_owner_state SET inventory_revision = inventory_revision + 1 WHERE owner_user_id = owner_id;
 RETURN receipt;
END $$;

REVOKE ALL ON FUNCTION public.valid_inventory_identity_v1(jsonb),public.valid_grading_record_v1(jsonb),public.valid_slot_wants_v1(jsonb),public.check_slot_placement_v1(),public.guard_storage_authority_v1(),public.guard_legacy_binder_write_v1(),
 public.legacy_binder_slot_id_v1(uuid,integer),public.legacy_binder_wants_v1(public.pokemon_collection),public.legacy_binder_evidence_v1(uuid),public.convert_legacy_binder_v1(uuid,uuid,text) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.valid_inventory_identity_v1(jsonb),public.valid_grading_record_v1(jsonb),public.valid_slot_wants_v1(jsonb),public.check_slot_placement_v1(),public.guard_storage_authority_v1(),public.legacy_binder_slot_id_v1(uuid,integer),
 public.legacy_binder_wants_v1(public.pokemon_collection),public.legacy_binder_evidence_v1(uuid),public.convert_legacy_binder_v1(uuid,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
