ALTER TABLE public.pokemon_collection
DROP CONSTRAINT IF EXISTS pokemon_collection_card_finish_check;

ALTER TABLE public.pokemon_collection
ADD CONSTRAINT pokemon_collection_card_finish_check
CHECK (card_finish IN (
  'normal',
  'holo',
  'reverse_holo',
  'double_rare',
  'ultra_rare',
  'illustration_rare',
  'special_illustration_rare',
  'secret_rare',
  'hyper_rare',
  'radiant_rare',
  'ace_spec',
  'amazing_rare',
  'shiny_rare',
  'jumbo'
));
