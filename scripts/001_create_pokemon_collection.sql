-- Pokemon collection table to store user's collected Pokemon
CREATE TABLE IF NOT EXISTS public.pokemon_collection (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pokemon_id INTEGER NOT NULL,
  pokemon_name TEXT NOT NULL,
  card_id TEXT,
  card_name TEXT,
  card_image TEXT,
  card_set TEXT,
  collected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, pokemon_id)
);

-- Enable Row Level Security
ALTER TABLE public.pokemon_collection ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own collection" 
  ON public.pokemon_collection FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert into their own collection" 
  ON public.pokemon_collection FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own collection" 
  ON public.pokemon_collection FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete from their own collection" 
  ON public.pokemon_collection FOR DELETE 
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_pokemon_collection_user_id ON public.pokemon_collection(user_id);
CREATE INDEX IF NOT EXISTS idx_pokemon_collection_pokemon_id ON public.pokemon_collection(pokemon_id);
