-- Personal API credentials and shared request budgets. No OAuth issuance is enabled here.
SET lock_timeout = '3s';
CREATE TABLE IF NOT EXISTS public.developer_api_keys (
 id uuid PRIMARY KEY,
 actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
 secret_digest text NOT NULL CHECK (secret_digest ~ '^[a-f0-9]{64}$'),
 permissions text[] NOT NULL CHECK (permissions <@ ARRAY['catalog:read','prices:read','prices:refresh','binders:read','binders:write','collection:read','collection:write','settings:read','settings:write','sharing:manage','partners:manage']::text[]),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS developer_api_keys_actor_idx ON public.developer_api_keys(actor_id);
ALTER TABLE public.developer_api_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.developer_api_keys FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.developer_api_keys TO service_role;

CREATE TABLE IF NOT EXISTS public.developer_request_budgets (
 bucket text NOT NULL CHECK (length(bucket) BETWEEN 1 AND 160),
 window_start timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 1,
 PRIMARY KEY(bucket,window_start)
);
ALTER TABLE public.developer_request_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.developer_request_budgets FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.developer_request_budgets TO service_role;

CREATE OR REPLACE FUNCTION public.create_developer_api_key(key_id uuid,actor uuid,key_name text,digest text,granted_permissions text[],expiry_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF expiry_days NOT IN (30,90,365) THEN RAISE EXCEPTION 'invalid_expiry'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(actor::text,5901));
 IF (SELECT count(*) FROM public.developer_api_keys WHERE actor_id=actor AND revoked_at IS NULL AND expires_at>now())>=10 THEN
  RAISE EXCEPTION 'key_limit_reached';
 END IF;
 INSERT INTO public.developer_api_keys(id,actor_id,name,secret_digest,permissions,expires_at)
 VALUES(key_id,actor,key_name,digest,granted_permissions,now()+make_interval(days=>expiry_days));
END $$;

CREATE OR REPLACE FUNCTION public.consume_developer_budget(budget_bucket text,request_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE used integer; window_time timestamptz:=date_trunc('minute',clock_timestamp());
BEGIN
 IF request_limit<1 OR request_limit>1000 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 INSERT INTO public.developer_request_budgets AS b(bucket,window_start,requests) VALUES(budget_bucket,window_time,1)
 ON CONFLICT(bucket,window_start) DO UPDATE SET requests=least(b.requests+1,1001) RETURNING requests INTO used;
 DELETE FROM public.developer_request_budgets WHERE (bucket,window_start) IN
 (SELECT bucket,window_start FROM public.developer_request_budgets WHERE window_start<now()-interval '1 day' LIMIT 100);
 RETURN jsonb_build_object('allowed',used<=request_limit,'retry_after',greatest(1,ceil(extract(epoch FROM window_time+interval '1 minute'-clock_timestamp()))));
END $$;
REVOKE ALL ON FUNCTION public.create_developer_api_key(uuid,uuid,text,text,text[],integer),public.consume_developer_budget(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_developer_api_key(uuid,uuid,text,text,text[],integer),public.consume_developer_budget(text,integer) TO service_role;
NOTIFY pgrst,'reload schema';
