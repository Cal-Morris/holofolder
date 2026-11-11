-- MCP authenticates once per HTTP request in one round trip, and request budgets stop cleaning on every call.
SET lock_timeout = '3s';

-- Cleanup runs only for the first request in a bucket's minute, so it keeps pace with the rows budgets add
-- without two DELETEs on every call. Every developer_idempotency reader without an expires_at filter
-- (storage ledgers in slot/inventory/recovery commands and storage_execute_v1's raw-restore check) reads
-- rows written with expires_at='infinity', which this never deletes; expiring rows are read with expires_at>now().
CREATE OR REPLACE FUNCTION public.consume_developer_budget(budget_bucket text, request_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE used integer; window_time timestamptz := date_trunc('minute', clock_timestamp());
BEGIN
 IF request_limit < 1 OR request_limit > 1000 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 INSERT INTO public.developer_request_budgets AS b(bucket, window_start, requests) VALUES(budget_bucket, window_time, 1)
 ON CONFLICT(bucket, window_start) DO UPDATE SET requests = least(b.requests + 1, 1001) RETURNING requests INTO used;
 IF used = 1 THEN
  DELETE FROM public.developer_request_budgets WHERE (bucket, window_start) IN
  (SELECT bucket, window_start FROM public.developer_request_budgets WHERE window_start < now() - interval '1 day' LIMIT 100);
  DELETE FROM public.developer_idempotency WHERE (actor_id, operation, request_key) IN
  (SELECT actor_id, operation, request_key FROM public.developer_idempotency WHERE expires_at < now() ORDER BY expires_at LIMIT 100);
 END IF;
 RETURN jsonb_build_object('allowed', used <= request_limit, 'retry_after', greatest(1, ceil(extract(epoch FROM window_time + interval '1 minute' - clock_timestamp()))));
END $$;
REVOKE ALL ON FUNCTION public.consume_developer_budget(text, integer) FROM PUBLIC, anon, authenticated, holo_mcp;
GRANT EXECUTE ON FUNCTION public.consume_developer_budget(text, integer) TO service_role;

-- The OAuth twin of authenticate_developer_request: IP budget, live grant and session, then
-- resolve_developer_access (partnership, billing, request budget). The caller verified the token's signature.
CREATE OR REPLACE FUNCTION public.authenticate_developer_oauth_request(
  session uuid, actor uuid, client uuid, grant_version uuid, request_kind text, preauth_bucket text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE budget jsonb; credential jsonb;
BEGIN
 IF request_kind IS NULL OR request_kind NOT IN ('read', 'write') THEN RAISE EXCEPTION 'invalid_request_kind'; END IF;
 IF preauth_bucket IS NOT NULL THEN
  IF preauth_bucket NOT LIKE 'preauth:%' THEN RAISE EXCEPTION 'invalid_preauth_bucket'; END IF;
  budget := public.consume_developer_budget(preauth_bucket, 1000);
  IF NOT (budget->>'allowed')::boolean THEN RETURN jsonb_build_object('error', 'rate_limited', 'retry_after', budget->'retry_after'); END IF;
 END IF;
 credential := public.verify_developer_oauth_session(session, actor, client, grant_version);
 IF credential IS NULL THEN RETURN jsonb_build_object('error', 'oauth_revoked'); END IF;
 RETURN public.resolve_developer_access(actor, request_kind) || jsonb_build_object('actor_id', actor,
   'credential_id', credential->'id', 'permissions', credential->'permissions', 'redirect_origin', credential->'redirect_origin');
END $$;
REVOKE ALL ON FUNCTION public.authenticate_developer_oauth_request(uuid, uuid, uuid, uuid, text, text) FROM PUBLIC, anon, authenticated, holo_mcp;
GRANT EXECUTE ON FUNCTION public.authenticate_developer_oauth_request(uuid, uuid, uuid, uuid, text, text) TO service_role;
NOTIFY pgrst, 'reload schema';
