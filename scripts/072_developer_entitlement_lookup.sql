-- Keep API/MCP authorization independent of the number of saved collection rows.
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
 -- Developer access needs paid entitlement, not an O(collection size) saved-card total.
 SELECT jsonb_build_object('perpetual',EXISTS(SELECT 1 FROM public.perpetual_licences WHERE owner_user_id=owner_id),
  'status',billing.status,'paid_through',billing.paid_through) INTO access
 FROM public.billing_configuration config LEFT JOIN public.billing_accounts billing ON billing.owner_user_id=owner_id
 WHERE config.id;
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

