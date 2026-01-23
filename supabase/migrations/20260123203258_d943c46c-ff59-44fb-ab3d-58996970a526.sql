-- Add voice_provider column to profiles table (default to elevenlabs for existing users)
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS voice_provider text DEFAULT 'elevenlabs';

-- Add vapi_assistant_id to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS vapi_assistant_id text;

-- Add vapi_assistant_id to phone_numbers table
ALTER TABLE public.phone_numbers 
ADD COLUMN IF NOT EXISTS vapi_assistant_id text;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_profiles_voice_provider ON public.profiles(voice_provider);
CREATE INDEX IF NOT EXISTS idx_profiles_vapi_assistant_id ON public.profiles(vapi_assistant_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_vapi_assistant_id ON public.phone_numbers(vapi_assistant_id);

-- Add comment for documentation
COMMENT ON COLUMN public.profiles.voice_provider IS 'Voice AI provider: elevenlabs or vapi';
COMMENT ON COLUMN public.profiles.vapi_assistant_id IS 'Vapi.ai Assistant ID for this user';
COMMENT ON COLUMN public.phone_numbers.vapi_assistant_id IS 'Vapi.ai Assistant ID connected to this phone number';