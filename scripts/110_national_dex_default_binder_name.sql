-- New accounts' default binder is called "National Dex" instead of "My binder", which read like
-- the viewer's own binder in share previews. Public slugs are assigned on insert only, so renaming
-- keeps every existing /@user/<slug> link working. Idempotent.
SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.ensure_default_binder(owner uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE found_id uuid; changes jsonb[];
BEGIN
  SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
  IF found_id IS NOT NULL THEN RETURN found_id; END IF;
  PERFORM set_config('collection_audit.command','on',true);
  changes := collection_audit_private.create_binder_rows(owner, 'National Dex', 0, true);
  IF changes IS NULL THEN
    -- A concurrent call created it first, with its own state row.
    SELECT b.id INTO found_id FROM public.binders b WHERE b.owner_user_id = owner AND b.is_default;
    RETURN found_id;
  END IF;
  PERFORM collection_audit_private.record_v1(owner,collection_audit_private.context(owner),NULL,changes,NULL,NULL);
  RETURN (changes[1]->>'id')::uuid;
END
$$;

-- Default binders still on the old untouched name. Recorded in each owner's activity as a rename.
UPDATE public.binders SET name = 'National Dex' WHERE is_default AND name = 'My binder';
