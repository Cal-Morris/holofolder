-- Restore 008's status contract and the settings contract reconstructed in MIGRATIONS.md.
UPDATE public.pokemon_collection
SET status = 'collected'
WHERE status IS NULL;

ALTER TABLE public.pokemon_collection
ALTER COLUMN status SET NOT NULL;

UPDATE public.user_settings
SET binder_rows = COALESCE(binder_rows, 4),
    binder_cols = COALESCE(binder_cols, 4),
    created_at = COALESCE(created_at, updated_at, now()),
    updated_at = COALESCE(updated_at, created_at, now())
WHERE binder_rows IS NULL
   OR binder_cols IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL;

-- When both timestamps were missing, the fallback records migration time, not historical creation time.
ALTER TABLE public.user_settings
ALTER COLUMN binder_rows SET NOT NULL,
ALTER COLUMN binder_cols SET NOT NULL,
ALTER COLUMN created_at SET NOT NULL,
ALTER COLUMN updated_at SET NOT NULL;
