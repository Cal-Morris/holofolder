-- Card images move to the holofolder-assets bucket under a brand/game prefix (pokemon/tcg/cards/...).
-- Allow both key shapes so rows for the old bucket (cards/...) and the new one coexist during the move.
SET lock_timeout = '3s';
ALTER TABLE public.card_image_inventory DROP CONSTRAINT IF EXISTS card_image_inventory_object_key_check;
ALTER TABLE public.card_image_inventory ADD CONSTRAINT card_image_inventory_object_key_check
  CHECK (object_key LIKE 'cards/%' OR object_key LIKE 'pokemon/tcg/cards/%');
