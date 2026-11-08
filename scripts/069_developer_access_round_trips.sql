-- Keep membership, billing and request-budget checks live, in one PostgREST round trip.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.resolve_developer_access(actor uuid,request_kind text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE membership public.partnerships; owner_id uuid:=actor; members uuid[]:=ARRAY[actor]; access jsonb; budget jsonb;
BEGIN
 IF request_kind IS NOT NULL AND request_kind NOT IN ('read','write') THEN RAISE EXCEPTION 'invalid_request_kind'; END IF;
 SELECT * INTO membership FROM public.partnerships WHERE user1_id=actor OR user2_id=actor LIMIT 1;
 IF membership.id IS NOT NULL AND public.billing_partner_allowed(membership.owner_user_id,actor) THEN
  owner_id:=membership.owner_user_id;
  members:=ARRAY(SELECT DISTINCT unnest(ARRAY[actor,membership.user1_id,membership.user2_id]));
 ELSE membership.id:=NULL;
 END IF;
 access:=public.get_billing_access(owner_id);
 IF access IS NULL THEN RAISE EXCEPTION 'billing_access_unavailable'; END IF;
 -- Trial access does not include API/MCP access. Match developerEntitled exactly.
 IF request_kind IS NOT NULL AND (coalesce((access->>'perpetual')::boolean,false)
  OR (access->>'status' IN ('active','past_due') AND (access->>'paid_through')::timestamptz>clock_timestamp())) THEN
  budget:=public.consume_developer_budget(actor::text||':'||request_kind,CASE request_kind WHEN 'read' THEN 60 ELSE 20 END);
 END IF;
 RETURN jsonb_build_object('owner_user_id',owner_id,'member_ids',members,'partnership_id',membership.id,'billing_access',access,'budget',budget);
END $$;
REVOKE ALL ON FUNCTION public.resolve_developer_access(uuid,text) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.resolve_developer_access(uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';

-- Hash the presented secret in the application; never send the bearer key to SQL.
CREATE OR REPLACE FUNCTION public.authenticate_developer_request(key_id uuid,presented_digest text,required_permissions text[],request_kind text,preauth_bucket text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE credential public.developer_api_keys; budget jsonb; access jsonb; expected bytea; presented bytea; difference integer:=0; n integer;
BEGIN
 IF preauth_bucket IS NOT NULL THEN
  IF preauth_bucket NOT LIKE 'preauth:%' THEN RAISE EXCEPTION 'invalid_preauth_bucket'; END IF;
  budget:=public.consume_developer_budget(preauth_bucket,1000);
  IF NOT (budget->>'allowed')::boolean THEN RETURN jsonb_build_object('error','rate_limited','retry_after',budget->'retry_after'); END IF;
 END IF;
 SELECT * INTO credential FROM public.developer_api_keys WHERE id=key_id;
 IF credential.id IS NULL OR credential.revoked_at IS NOT NULL OR credential.expires_at<=clock_timestamp() OR NOT isfinite(credential.expires_at)
  OR presented_digest IS NULL OR presented_digest !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('error','invalid_api_key'); END IF;
 expected:=decode(credential.secret_digest,'hex'); presented:=decode(presented_digest,'hex');
 -- Compare all 32 bytes without a prefix-dependent early return.
 FOR n IN 0..31 LOOP difference:=difference | (get_byte(expected,n) # get_byte(presented,n)); END LOOP;
 IF difference<>0 THEN RETURN jsonb_build_object('error','invalid_api_key'); END IF;
 IF credential.last_used_at IS NULL OR credential.last_used_at<clock_timestamp()-interval '1 hour' THEN
  UPDATE public.developer_api_keys SET last_used_at=clock_timestamp() WHERE id=key_id AND revoked_at IS NULL;
 END IF;
 IF required_permissions IS NULL OR NOT (required_permissions <@ credential.permissions) THEN RETURN jsonb_build_object('error','insufficient_permissions'); END IF;
 access:=public.resolve_developer_access(credential.actor_id,request_kind);
 RETURN access || jsonb_build_object('actor_id',credential.actor_id,'credential_id',credential.id,'permissions',credential.permissions);
END $$;
REVOKE ALL ON FUNCTION public.authenticate_developer_request(uuid,text,text[],text,text) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.authenticate_developer_request(uuid,text,text[],text,text) TO service_role;
NOTIFY pgrst,'reload schema';
