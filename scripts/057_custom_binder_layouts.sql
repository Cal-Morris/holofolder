-- Custom layouts are premium; existing layouts remain readable and editable after expiry.
SET lock_timeout = '3s';
ALTER TABLE public.binders DROP CONSTRAINT IF EXISTS binders_grid_check;
ALTER TABLE public.binders ADD CONSTRAINT binders_grid_check CHECK (
  (binder_rows IS NULL OR binder_rows BETWEEN 1 AND 8) AND
  (binder_cols IS NULL OR binder_cols BETWEEN 1 AND 8)
);

CREATE OR REPLACE FUNCTION public.enforce_custom_binder_layout() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  next_row jsonb := to_jsonb(NEW);
  old_row jsonb;
  next_grid jsonb;
  old_grid jsonb;
  owner_id uuid;
  r numeric;
  c numeric;
BEGIN
  IF TG_OP = 'UPDATE' THEN old_row := to_jsonb(OLD); END IF;
  IF TG_TABLE_NAME = 'binder_appearances' THEN
    next_grid := jsonb_build_array(next_row->'design'->'rows', next_row->'design'->'cols');
    old_grid := jsonb_build_array(old_row->'design'->'rows', old_row->'design'->'cols');
  ELSE
    next_grid := jsonb_build_array(next_row->'binder_rows', next_row->'binder_cols');
    old_grid := jsonb_build_array(old_row->'binder_rows', old_row->'binder_cols');
  END IF;
  -- Unrelated edits to retained layouts never need a subscription.
  IF TG_OP = 'UPDATE' AND next_grid = old_grid THEN RETURN NEW; END IF;
  -- A binder with no override continues to inherit the account's layout.
  IF next_grid = '[null,null]'::jsonb THEN RETURN NEW; END IF;
  IF jsonb_typeof(next_grid->0) <> 'number' OR jsonb_typeof(next_grid->1) <> 'number' THEN
    RAISE EXCEPTION 'Invalid binder layout' USING ERRCODE = '23514';
  END IF;
  r := (next_grid->>0)::numeric;
  c := (next_grid->>1)::numeric;
  IF r IS NULL OR c IS NULL OR r <> trunc(r) OR c <> trunc(c) OR r NOT BETWEEN 1 AND 8 OR c NOT BETWEEN 1 AND 8 THEN
    RAISE EXCEPTION 'Invalid binder layout' USING ERRCODE = '23514';
  END IF;
  IF (r,c) IN ((1,1),(2,2),(3,3),(3,4),(4,3),(4,4)) THEN RETURN NEW; END IF;
  owner_id := coalesce(next_row->>'owner_user_id', next_row->>'user_id')::uuid;
  IF public.billing_enforced() AND NOT public.billing_has_paid(owner_id) THEN
    RAISE EXCEPTION 'upgrade_required' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_custom_binder_layout() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_custom_binder_layout ON public.binders;
CREATE TRIGGER enforce_custom_binder_layout BEFORE INSERT OR UPDATE ON public.binders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_binder_layout();
DROP TRIGGER IF EXISTS enforce_custom_binder_layout ON public.user_settings;
CREATE TRIGGER enforce_custom_binder_layout BEFORE INSERT OR UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_binder_layout();
DROP TRIGGER IF EXISTS enforce_custom_binder_layout ON public.binder_appearances;
CREATE TRIGGER enforce_custom_binder_layout BEFORE INSERT OR UPDATE ON public.binder_appearances
  FOR EACH ROW EXECUTE FUNCTION public.enforce_custom_binder_layout();
NOTIFY pgrst, 'reload schema';
