-- Lazy bounded cleanup applies to API/MCP traffic, including comparison-only clients.
SET lock_timeout = '3s';
CREATE INDEX IF NOT EXISTS developer_idempotency_expiry ON public.developer_idempotency(expires_at);
CREATE OR REPLACE FUNCTION public.consume_developer_budget(budget_bucket text,request_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE used integer; window_time timestamptz:=date_trunc('minute',clock_timestamp());
BEGIN
 IF request_limit<1 OR request_limit>1000 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 INSERT INTO public.developer_request_budgets AS b(bucket,window_start,requests) VALUES(budget_bucket,window_time,1)
 ON CONFLICT(bucket,window_start) DO UPDATE SET requests=least(b.requests+1,1001) RETURNING requests INTO used;
 DELETE FROM public.developer_request_budgets WHERE (bucket,window_start) IN
 (SELECT bucket,window_start FROM public.developer_request_budgets WHERE window_start<now()-interval '1 day' LIMIT 100);
 DELETE FROM public.developer_idempotency WHERE (actor_id,operation,request_key) IN
 (SELECT actor_id,operation,request_key FROM public.developer_idempotency WHERE expires_at<now() ORDER BY expires_at LIMIT 100);
 RETURN jsonb_build_object('allowed',used<=request_limit,'retry_after',greatest(1,ceil(extract(epoch FROM window_time+interval '1 minute'-clock_timestamp()))));
END $$;
REVOKE ALL ON FUNCTION public.consume_developer_budget(text,integer) FROM PUBLIC,anon,authenticated,holo_mcp;
GRANT EXECUTE ON FUNCTION public.consume_developer_budget(text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
