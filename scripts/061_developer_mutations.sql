-- Transactional retries for external creation and atomic compare-and-delete for collection slots.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.developer_idempotency (
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 operation text NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 8 AND 100),
 input_digest text NOT NULL CHECK(input_digest ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '1 day'),
 PRIMARY KEY(actor_id,operation,request_key)
);
ALTER TABLE public.developer_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.developer_idempotency FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT ALL ON public.developer_idempotency TO service_role;
CREATE OR REPLACE FUNCTION public.developer_create_binder(actor uuid,owner_id uuid,binder_name text,retry_key text,digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result) VALUES(actor,'create_binder',retry_key,digest,jsonb_build_object('id',saved_id))
 ON CONFLICT(actor_id,operation,request_key) DO UPDATE SET input_digest=excluded.input_digest,result=excluded.result,expires_at=excluded.expires_at;
 DELETE FROM public.developer_idempotency WHERE (actor_id,operation,request_key) IN(SELECT actor_id,operation,request_key FROM public.developer_idempotency WHERE expires_at<now() LIMIT 100);
 RETURN jsonb_build_object('id',saved_id);
END $$;
CREATE OR REPLACE FUNCTION public.developer_delete_collection(actor uuid,owner_id uuid,binder uuid,pokemon integer,expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE previous public.pokemon_collection; membership public.partnerships;
BEGIN
 PERFORM 1 FROM public.binders WHERE id=binder AND owner_user_id=owner_id FOR KEY SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Binder not found'; END IF;
 SELECT * INTO membership FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id) LIMIT 1 FOR KEY SHARE;
 IF actor<>owner_id AND membership.id IS NULL THEN RAISE EXCEPTION 'Collection access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(binder::text||':'||pokemon::text,0));
 SELECT * INTO previous FROM public.pokemon_collection WHERE user_id=owner_id AND binder_id=binder AND pokemon_id=pokemon FOR UPDATE;
 IF (CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous) END) IS DISTINCT FROM expected THEN RETURN jsonb_build_object('conflict',true); END IF;
 DELETE FROM public.pokemon_collection WHERE user_id=owner_id AND binder_id=binder AND pokemon_id=pokemon;
 RETURN jsonb_build_object('deleted',true);
END $$;
REVOKE ALL ON FUNCTION public.developer_create_binder(uuid,uuid,text,text,text),public.developer_delete_collection(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_create_binder(uuid,uuid,text,text,text),public.developer_delete_collection(uuid,uuid,uuid,integer,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
