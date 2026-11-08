-- Specific service-role operations reuse the existing identity rules and transact partner changes.
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.developer_claim_identity(actor uuid,username text,binder uuid,slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE claimed text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=actor) THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 -- Identity routines already validate reservations and owner-only editing using auth.uid().
 -- These claims are transaction-local, never issued to a caller as a token.
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 IF username IS NOT NULL THEN claimed:=public.claim_account_username(username); END IF;
 IF binder IS NOT NULL THEN PERFORM public.set_binder_public_slug(binder,slug); END IF;
 RETURN jsonb_build_object('username',claimed);
END $$;
CREATE OR REPLACE FUNCTION public.developer_partner_action(actor uuid,action text,email text,invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor_email text; invitation public.partner_invites; result_id uuid;
BEGIN
 SELECT u.email INTO actor_email FROM auth.users u WHERE u.id=actor;
 IF actor_email IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='42501'; END IF;
 IF action='invite' THEN
  IF email IS NULL OR length(email)>254 OR lower(email)=lower(actor_email) OR email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Invalid invite email' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,6201));
  IF public.billing_enforced() AND NOT public.billing_has_paid(actor) THEN RAISE EXCEPTION 'upgrade_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.partnerships WHERE actor IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Already partnered'; END IF;
  SELECT id INTO result_id FROM public.partner_invites WHERE inviter_id=actor AND lower(invitee_email)=lower(email) AND status='pending' ORDER BY created_at LIMIT 1;
  IF result_id IS NULL THEN INSERT INTO public.partner_invites(inviter_id,inviter_email,invitee_email,status) VALUES(actor,actor_email,lower(email),'pending') RETURNING id INTO result_id; END IF;
 ELSIF action IN('accept','reject') THEN
  SELECT * INTO invitation FROM public.partner_invites WHERE id=invite_id AND lower(invitee_email)=lower(actor_email) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invite not found' USING ERRCODE='42501'; END IF;
  IF action='reject' THEN
   UPDATE public.partner_invites SET status='rejected' WHERE id=invitation.id AND status='pending';
   RETURN jsonb_build_object('id',invitation.id,'rejected',true);
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(least(actor,invitation.inviter_id)::text,6201));
  PERFORM pg_advisory_xact_lock(hashtextextended(greatest(actor,invitation.inviter_id)::text,6201));
  SELECT id INTO result_id FROM public.partnerships WHERE user1_id=least(actor,invitation.inviter_id) AND user2_id=greatest(actor,invitation.inviter_id) AND owner_user_id=invitation.inviter_id;
  IF invitation.status='accepted' AND result_id IS NOT NULL THEN RETURN jsonb_build_object('id',result_id,'success',true); END IF;
  IF invitation.status<>'pending' OR actor=invitation.inviter_id THEN RAISE EXCEPTION 'Invite no longer pending'; END IF;
  IF public.billing_enforced() AND NOT public.billing_has_paid(invitation.inviter_id) THEN RAISE EXCEPTION 'upgrade_required'; END IF;
  IF EXISTS(SELECT 1 FROM public.partnerships WHERE actor IN(user1_id,user2_id) OR invitation.inviter_id IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Already partnered'; END IF;
  INSERT INTO public.partnerships(user1_id,user2_id,owner_user_id) VALUES(least(actor,invitation.inviter_id),greatest(actor,invitation.inviter_id),invitation.inviter_id) RETURNING id INTO result_id;
  UPDATE public.partner_invites SET status='accepted' WHERE id=invitation.id;
 ELSIF action='disconnect' THEN
  DELETE FROM public.partnerships WHERE actor IN(user1_id,user2_id);
 ELSE RAISE EXCEPTION 'Invalid partner action' USING ERRCODE='22023';
 END IF;
 RETURN jsonb_build_object('id',result_id,'success',true);
END $$;
CREATE OR REPLACE FUNCTION public.developer_create_comparison_job(actor uuid,owner_id uuid,scope text,job_targets jsonb,job_progress jsonb,retry_key text,digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE existing public.developer_idempotency; job public.comparison_jobs; created boolean:=false;
BEGIN
 IF actor<>owner_id AND NOT EXISTS(SELECT 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Collection access denied'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text||':comparison:'||retry_key,6101));
 SELECT * INTO existing FROM public.developer_idempotency WHERE actor_id=actor AND operation='start_comparison_job' AND request_key=retry_key AND expires_at>now();
 IF FOUND THEN
  IF existing.input_digest<>digest THEN RAISE EXCEPTION 'idempotency_conflict'; END IF;
  SELECT * INTO job FROM public.comparison_jobs WHERE id=(existing.result->>'id')::uuid AND owner_user_id=owner_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Job no longer available'; END IF;
  RETURN jsonb_build_object('job',to_jsonb(job),'created',false);
 END IF;
 INSERT INTO public.comparison_jobs(owner_user_id,scope_key,targets,progress,initiated_by) VALUES(owner_id,scope,job_targets,job_progress,actor)
 ON CONFLICT DO NOTHING RETURNING * INTO job;
 IF job.id IS NOT NULL THEN created:=true;
 ELSE SELECT * INTO job FROM public.comparison_jobs WHERE owner_user_id=owner_id AND scope_key=scope AND status IN('queued','running') LIMIT 1; END IF;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Comparison job unavailable'; END IF;
 INSERT INTO public.developer_idempotency(actor_id,operation,request_key,input_digest,result) VALUES(actor,'start_comparison_job',retry_key,digest,jsonb_build_object('id',job.id))
 ON CONFLICT(actor_id,operation,request_key) DO UPDATE SET input_digest=excluded.input_digest,result=excluded.result,expires_at=excluded.expires_at;
 RETURN jsonb_build_object('job',to_jsonb(job),'created',created);
END $$;
REVOKE ALL ON FUNCTION public.developer_claim_identity(uuid,text,uuid,text),public.developer_partner_action(uuid,text,text,uuid),public.developer_create_comparison_job(uuid,uuid,text,jsonb,jsonb,text,text) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_claim_identity(uuid,text,uuid,text),public.developer_partner_action(uuid,text,text,uuid),public.developer_create_comparison_job(uuid,uuid,text,jsonb,jsonb,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
CREATE OR REPLACE FUNCTION public.developer_reorder_binders(actor uuid,owner_id uuid,binder_order uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF actor<>owner_id AND NOT EXISTS(SELECT 1 FROM public.partnerships WHERE owner_user_id=owner_id AND actor IN(user1_id,user2_id)) THEN RAISE EXCEPTION 'Collection access denied' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text,6102));
 IF cardinality(binder_order)>20 OR cardinality(binder_order)<1 OR cardinality(binder_order)<>(SELECT count(*) FROM public.binders WHERE owner_user_id=owner_id) OR (SELECT count(DISTINCT id) FROM unnest(binder_order) AS id)<>cardinality(binder_order) OR EXISTS(SELECT 1 FROM unnest(binder_order) AS requested(id) WHERE NOT EXISTS(SELECT 1 FROM public.binders b WHERE b.id=requested.id AND b.owner_user_id=owner_id)) THEN RAISE EXCEPTION 'Invalid binder order' USING ERRCODE='22023'; END IF;
 UPDATE public.binders AS b SET sort_order=position.ordinality-1 FROM unnest(binder_order) WITH ORDINALITY AS position(id,ordinality) WHERE b.id=position.id AND b.owner_user_id=owner_id;
END $$;
REVOKE ALL ON FUNCTION public.developer_reorder_binders(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.developer_reorder_binders(uuid,uuid,uuid[]) TO service_role;
NOTIFY pgrst,'reload schema';
