-- Add elevenlabs_agent_id to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS elevenlabs_agent_id text;

-- Add elevenlabs_agent_id to phone_numbers table
ALTER TABLE public.phone_numbers 
ADD COLUMN IF NOT EXISTS elevenlabs_agent_id text;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_profiles_agent_id ON public.profiles(elevenlabs_agent_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_agent_id ON public.phone_numbers(elevenlabs_agent_id);