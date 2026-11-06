-- Shared recent searches/cards. Entries are bounded, server-dated and updated atomically per binder.
-- Clear changes a generation: pre-clear offline actions cannot restore cleared history.
-- Per-device sequence receipts make retries idempotent even when another device updates the same entry.
SET lock_timeout = '3s';

CREATE TABLE IF NOT EXISTS public.binder_history_state (
  binder_id uuid PRIMARY KEY REFERENCES public.binders(id) ON DELETE CASCADE,
  card_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  search_generation uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'
);
CREATE TABLE IF NOT EXISTS public.binder_history_entries (
  binder_id uuid NOT NULL REFERENCES public.binders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('card', 'search')),
  entry_key text NOT NULL CHECK (length(entry_key) BETWEEN 1 AND 240),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 8192),
  viewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (binder_id, kind, entry_key)
);
CREATE TABLE IF NOT EXISTS public.binder_history_clients (
  binder_id uuid NOT NULL REFERENCES public.binders(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (binder_id, client_id)
);

ALTER TABLE public.binder_history_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.binder_history_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.binder_history_clients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.binder_history_state, public.binder_history_entries, public.binder_history_clients FROM anon, authenticated;
GRANT SELECT ON public.binder_history_state, public.binder_history_entries TO authenticated;
GRANT ALL ON public.binder_history_state, public.binder_history_entries, public.binder_history_clients TO service_role;

DROP POLICY IF EXISTS "Read shared binder history state" ON public.binder_history_state;
CREATE POLICY "Read shared binder history state" ON public.binder_history_state FOR SELECT TO authenticated USING (
  binder_id IN (SELECT b.id FROM public.binders b WHERE b.owner_user_id = (select auth.uid()) OR b.owner_user_id IN (
    SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
  ))
);
DROP POLICY IF EXISTS "Read shared binder history entries" ON public.binder_history_entries;
CREATE POLICY "Read shared binder history entries" ON public.binder_history_entries FOR SELECT TO authenticated USING (
  binder_id IN (SELECT b.id FROM public.binders b WHERE b.owner_user_id = (select auth.uid()) OR b.owner_user_id IN (
    SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = (select auth.uid()) OR p.user2_id = (select auth.uid())
  ))
);

CREATE OR REPLACE FUNCTION public.sync_binder_history(
  target_binder uuid, expected_owner uuid, expected_account uuid, device_id uuid, actions jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor uuid := (select auth.uid());
  owner_id uuid;
  state public.binder_history_state%ROWTYPE;
  action jsonb;
  payload jsonb;
  action_kind text;
  entry text;
  generation uuid;
  action_id uuid;
  sequence bigint;
  last_sequence bigint;
  query text;
  stamp timestamptz;
BEGIN
  IF actor IS NULL OR actor IS DISTINCT FROM expected_account OR device_id IS NULL THEN
    RAISE EXCEPTION 'History account changed' USING ERRCODE = '42501';
  END IF;
  SELECT owner_user_id INTO owner_id FROM public.binders WHERE id = target_binder;
  IF owner_id IS NULL OR owner_id IS DISTINCT FROM expected_owner OR NOT (
    owner_id = actor OR owner_id IN (SELECT p.owner_user_id FROM public.partnerships p WHERE p.user1_id = actor OR p.user2_id = actor)
  ) THEN
    RAISE EXCEPTION 'Binder not found' USING ERRCODE = '42501';
  END IF;
  IF actions IS NULL OR jsonb_typeof(actions) <> 'array' OR jsonb_array_length(actions) > 100 OR octet_length(actions::text) > 850000 THEN
    RAISE EXCEPTION 'Invalid history actions' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.binder_history_state(binder_id) VALUES (target_binder) ON CONFLICT DO NOTHING;
  SELECT * INTO state FROM public.binder_history_state WHERE binder_id = target_binder FOR UPDATE;
  SELECT last_seq INTO last_sequence FROM public.binder_history_clients WHERE binder_id = target_binder AND client_id = device_id;
  last_sequence := coalesce(last_sequence, 0);

  FOR action IN SELECT value FROM jsonb_array_elements(actions) LOOP
    sequence := (action->>'seq')::bigint;
    action_kind := action->>'kind';
    generation := (action->>'generation')::uuid;
    action_id := (action->>'id')::uuid;
    IF sequence IS NULL OR sequence < 1 OR action_kind IS NULL OR action_kind NOT IN ('card', 'search') OR generation IS NULL OR action_id IS NULL
      OR action->>'op' IS NULL OR action->>'op' NOT IN ('add', 'clear') THEN
      RAISE EXCEPTION 'Invalid history action' USING ERRCODE = '22023';
    END IF;
    IF sequence <= last_sequence THEN CONTINUE; END IF;
    last_sequence := sequence;
    -- A clear on either device invalidates old offline actions of this kind.
    IF generation <> (CASE action_kind WHEN 'card' THEN state.card_generation ELSE state.search_generation END) THEN CONTINUE; END IF;
    IF action->>'op' = 'clear' THEN
      DELETE FROM public.binder_history_entries WHERE binder_id = target_binder AND binder_history_entries.kind = action_kind;
      IF action_kind = 'card' THEN state.card_generation := action_id; ELSE state.search_generation := action_id; END IF;
      CONTINUE;
    END IF;
    payload := action->'value';
    IF action_kind = 'search' THEN
      IF jsonb_typeof(payload) <> 'string' THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE = '22023'; END IF;
      query := left(trim(regexp_replace(payload #>> '{}', '\s+', ' ', 'g')), 60);
      IF length(query) < 2 THEN RAISE EXCEPTION 'Invalid search' USING ERRCODE = '22023'; END IF;
      entry := lower(query);
      payload := to_jsonb(query);
    ELSE
      IF payload IS NULL OR jsonb_typeof(payload) <> 'object' OR octet_length(payload::text) > 8192
        OR coalesce(length(payload->>'id'), 0) NOT BETWEEN 1 AND 200
        OR coalesce(length(payload->>'name'), 0) NOT BETWEEN 1 AND 200
        OR jsonb_typeof(payload->'id') IS DISTINCT FROM 'string'
        OR jsonb_typeof(payload->'name') IS DISTINCT FROM 'string'
        OR jsonb_typeof(payload->'number') IS DISTINCT FROM 'string'
        OR jsonb_typeof(payload->'setName') IS DISTINCT FROM 'string'
        OR jsonb_typeof(payload->'pokemonName') IS DISTINCT FROM 'string'
        OR coalesce(payload->>'dexId', '') !~ '^[0-9]{1,5}$'
        OR (payload->>'dexId')::integer NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION 'Invalid recent card' USING ERRCODE = '22023';
      END IF;
      entry := payload->>'id';
    END IF;
    stamp := clock_timestamp();
    IF action_kind = 'card' THEN payload := payload || jsonb_build_object('viewedAt', stamp); END IF;
    INSERT INTO public.binder_history_entries(binder_id, kind, entry_key, payload, viewed_at)
      VALUES (target_binder, action_kind, entry, payload, stamp)
      ON CONFLICT (binder_id, kind, entry_key) DO UPDATE SET payload = EXCLUDED.payload, viewed_at = EXCLUDED.viewed_at;
    DELETE FROM public.binder_history_entries WHERE binder_id = target_binder AND binder_history_entries.kind = action_kind
      AND entry_key IN (SELECT entry_key FROM public.binder_history_entries WHERE binder_id = target_binder AND binder_history_entries.kind = action_kind
        ORDER BY viewed_at DESC, entry_key OFFSET (CASE action_kind WHEN 'card' THEN 20 ELSE 8 END));
  END LOOP;
  UPDATE public.binder_history_state SET card_generation = state.card_generation, search_generation = state.search_generation WHERE binder_id = target_binder;
  IF jsonb_array_length(actions) > 0 THEN
    INSERT INTO public.binder_history_clients(binder_id, client_id, last_seq) VALUES (target_binder, device_id, last_sequence)
      ON CONFLICT (binder_id, client_id) DO UPDATE SET last_seq = EXCLUDED.last_seq;
  END IF;
  RETURN jsonb_build_object(
    'generations', jsonb_build_object('card', state.card_generation, 'search', state.search_generation),
    'cards', coalesce((SELECT jsonb_agg(binder_history_entries.payload ORDER BY viewed_at DESC, entry_key) FROM public.binder_history_entries WHERE binder_id = target_binder AND binder_history_entries.kind = 'card'), '[]'::jsonb),
    'searches', coalesce((SELECT jsonb_agg(binder_history_entries.payload ORDER BY viewed_at DESC, entry_key) FROM public.binder_history_entries WHERE binder_id = target_binder AND binder_history_entries.kind = 'search'), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.sync_binder_history(uuid, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_binder_history(uuid, uuid, uuid, uuid, jsonb) TO authenticated;
