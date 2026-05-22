CREATE TABLE IF NOT EXISTS public.tcg_series (
  id TEXT PRIMARY KEY,
  name_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  name_en TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tcg_sets (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES public.tcg_series(id) ON DELETE CASCADE,
  name_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  name_en TEXT,
  official_card_count INTEGER,
  release_date DATE,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tcg_cards (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES public.tcg_series(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES public.tcg_sets(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,
  local_id_sort INTEGER,
  name_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  name_en TEXT,
  category TEXT,
  rarity TEXT,
  hp INTEGER,
  illustrator TEXT,
  types_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_languages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  variants_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT tcg_cards_set_local_unique UNIQUE (set_id, local_id)
);

ALTER TABLE public.tcg_cards
ADD COLUMN IF NOT EXISTS image_languages_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.tcg_cards
ADD COLUMN IF NOT EXISTS external_ids_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.tcg_cards
DROP COLUMN IF EXISTS evolves_from_json,
DROP COLUMN IF EXISTS stage,
DROP COLUMN IF EXISTS suffix,
DROP COLUMN IF EXISTS regulation_mark,
DROP COLUMN IF EXISTS attacks_json,
DROP COLUMN IF EXISTS abilities_json,
DROP COLUMN IF EXISTS weaknesses_json,
DROP COLUMN IF EXISTS resistances_json,
DROP COLUMN IF EXISTS retreat_cost,
DROP COLUMN IF EXISTS legalities_json,
DROP COLUMN IF EXISTS rules_json;

CREATE TABLE IF NOT EXISTS public.tcg_card_dex_ids (
  card_id TEXT NOT NULL REFERENCES public.tcg_cards(id) ON DELETE CASCADE,
  dex_id INTEGER NOT NULL,
  PRIMARY KEY (card_id, dex_id)
);

CREATE TABLE IF NOT EXISTS public.tcg_card_external_sources (
  card_id TEXT NOT NULL REFERENCES public.tcg_cards(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_card_id TEXT NOT NULL,
  source_set_id TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, source)
);

CREATE INDEX IF NOT EXISTS idx_tcg_sets_series_id
  ON public.tcg_sets(series_id);

CREATE INDEX IF NOT EXISTS idx_tcg_cards_set_id
  ON public.tcg_cards(set_id);

CREATE INDEX IF NOT EXISTS idx_tcg_cards_set_local_sort
  ON public.tcg_cards(set_id, local_id_sort);

CREATE INDEX IF NOT EXISTS idx_tcg_cards_series_id
  ON public.tcg_cards(series_id);

CREATE INDEX IF NOT EXISTS idx_tcg_cards_name_en
  ON public.tcg_cards(name_en);

CREATE INDEX IF NOT EXISTS idx_tcg_cards_local_id_sort
  ON public.tcg_cards(local_id_sort);

CREATE INDEX IF NOT EXISTS idx_tcg_card_dex_ids_dex_id
  ON public.tcg_card_dex_ids(dex_id);

CREATE INDEX IF NOT EXISTS idx_tcg_card_external_sources_source_card
  ON public.tcg_card_external_sources(source, source_card_id);

ALTER TABLE public.tcg_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_card_dex_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tcg_card_external_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read TCG series" ON public.tcg_series;
CREATE POLICY "Anyone can read TCG series"
  ON public.tcg_series FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read TCG sets" ON public.tcg_sets;
CREATE POLICY "Anyone can read TCG sets"
  ON public.tcg_sets FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read TCG cards" ON public.tcg_cards;
CREATE POLICY "Anyone can read TCG cards"
  ON public.tcg_cards FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read TCG dex links" ON public.tcg_card_dex_ids;
CREATE POLICY "Anyone can read TCG dex links"
  ON public.tcg_card_dex_ids FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can read TCG card external sources" ON public.tcg_card_external_sources;
CREATE POLICY "Anyone can read TCG card external sources"
  ON public.tcg_card_external_sources FOR SELECT
  USING (true);
