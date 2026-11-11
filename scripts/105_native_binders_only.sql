-- Every binder is native. Binder creation writes its slots state row in the same transaction,
-- and counts read only the native tables. pokemon_collection stays frozen until 107 drops it.
-- storage_collection_state.authority stays too: ~25 functions still check it, and 107 removes them together.
BEGIN;
SET LOCAL lock_timeout = '3s';

-- Default binder for an owner who has none (binder list, developer API, verify scripts).
CREATE OR REPLACE FUNCTION public.ensure_default_binder(owner uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE found_id uuid;
BEGIN
  SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
  IF found_id IS NOT NULL THEN RETURN found_id; END IF;
  INSERT INTO public.binders(owner_user_id, name, sort_order, is_default)
  VALUES (owner, 'My binder', 0, true)
  ON CONFLICT (owner_user_id) WHERE is_default DO NOTHING
  RETURNING id INTO found_id;
  IF found_id IS NULL THEN
    -- A concurrent call created it first, with its own state row.
    SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
    RETURN found_id;
  END IF;
  INSERT INTO public.inventory_owner_state(owner_user_id) VALUES (owner) ON CONFLICT DO NOTHING;
  INSERT INTO public.storage_collection_state(collection_id, owner_user_id, authority) VALUES (found_id, owner, 'slots');
  UPDATE public.inventory_owner_state SET inventory_revision = inventory_revision + 1 WHERE owner_user_id = owner;
  RETURN found_id;
END
$$;
REVOKE ALL ON FUNCTION public.ensure_default_binder(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_default_binder(uuid) TO service_role;

-- Named binder creation (/api/binders POST, developer create_binder).
CREATE OR REPLACE FUNCTION public.developer_create_binder(actor uuid, owner_id uuid, binder_name text, retry_key text, digest text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE existing public.developer_idempotency; saved_id uuid; binder_count integer; next_sort integer;
BEGIN
 IF actor<>owner_id AND NOT EXISTS(SELECT 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Collection access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':create_binder:'||retry_key,6101));
 SELECT * INTO existing FROM public.developer_idempotency WHERE actor_id=actor AND operation='create_binder' AND request_key=retry_key AND expires_at>now();
 IF FOUND THEN
  IF existing.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  RETURN existing.result;
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 SELECT count(*),coalesce(max(sort_order),-1)+1 INTO binder_count,next_sort FROM public.binders WHERE owner_user_id=owner_id;
 IF binder_count>=20 THEN RAISE EXCEPTION 'binder_safety_limit_reached'; END IF;
 INSERT INTO public.binders(owner_user_id,name,sort_order,is_default) VALUES(owner_id,binder_name,next_sort,binder_count=0) RETURNING id INTO saved_id;
 INSERT INTO public.inventory_owner_state(owner_user_id) VALUES(owner_id) ON CONFLICT DO NOTHING;
 INSERT INTO public.storage_collection_state(collection_id,owner_user_id,authority) VALUES(saved_id,owner_id,'slots');
 UPDATE public.inventory_owner_state SET inventory_revision=inventory_revision+1 WHERE owner_user_id=owner_id;
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result) VALUES(actor,'create_binder',retry_key,digest,jsonb_build_object('id',saved_id))
 ON CONFLICT(actor_id,operation,request_key) DO UPDATE SET input_digest=excluded.input_digest,result=excluded.result,expires_at=excluded.expires_at;
 DELETE FROM public.developer_idempotency WHERE (actor_id,operation,request_key) IN(SELECT actor_id,operation,request_key FROM public.developer_idempotency WHERE expires_at<now() LIMIT 100);
 RETURN jsonb_build_object('id',saved_id);
END $$;
REVOKE ALL ON FUNCTION public.developer_create_binder(uuid,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.developer_create_binder(uuid,uuid,text,text,text) TO service_role;

-- Binder switcher and developer list_binders counts: native slots per binder.
CREATE OR REPLACE FUNCTION public.get_binder_slot_counts(owner_id uuid)
RETURNS TABLE(binder_id uuid, slot_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT s.collection_id, count(*) FROM public.binder_slots s
 WHERE s.owner_user_id = owner_id GROUP BY s.collection_id
$$;
REVOKE ALL ON FUNCTION public.get_binder_slot_counts(uuid) FROM PUBLIC, anon, authenticated, holo_mcp;
GRANT EXECUTE ON FUNCTION public.get_binder_slot_counts(uuid) TO service_role;

-- Billing weight of an owner's saved cards: owned copies plus wanted slots.
CREATE OR REPLACE FUNCTION public.slot_saved_count_v1(owner_id uuid)
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT (SELECT count(*) FROM public.inventory_items WHERE owner_user_id = owner_id)
 + (SELECT coalesce(sum(greatest(jsonb_array_length(s.wanted_cards), CASE WHEN s.status = 'wishlisted' THEN 1 ELSE 0 END)
     + CASE WHEN s.status = 'considering' THEN 1 ELSE 0 END), 0)
    FROM public.binder_slots s WHERE s.owner_user_id = owner_id)
$$;
REVOKE ALL ON FUNCTION public.slot_saved_count_v1(uuid) FROM PUBLIC, anon, authenticated, holo_mcp;

NOTIFY pgrst, 'reload schema';
COMMIT;
