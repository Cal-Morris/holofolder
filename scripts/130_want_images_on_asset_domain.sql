-- Saved want images point at our asset domain instead of assets.tcgdex.net. Every stored TCGdex URL has the shape
-- https://assets.tcgdex.net/<lang>/<series>/<set>/<localId>/<quality>.<ext>; our key drops the series
-- (pokemon/tcg/cards/<lang>/<set>/<localId>/<quality>.<ext>, see getCardImageBlobPathname). Segments are plain
-- [A-Za-z0-9._!-], so the text rewrite is exact. Anything else is left alone; the app maps it on read.
-- `version` is not bumped: only the image hint changes, and a bump would 409 queued offline edits.
-- collection_activity is append-only and keeps its historical URLs. Idempotent.
UPDATE public.binder_slots
SET wanted_cards = regexp_replace(
  wanted_cards::text,
  '"https://assets\.tcgdex\.net/([A-Za-z0-9._!-]+)/[A-Za-z0-9._!-]+/([A-Za-z0-9._!-]+/[A-Za-z0-9._!-]+/(high|low)\.(webp|png|jpg))"',
  '"https://assets.holofolder.com/pokemon/tcg/cards/\1/\2"',
  'g'
)::jsonb
WHERE wanted_cards::text LIKE '%assets.tcgdex.net%';
