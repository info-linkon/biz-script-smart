-- Create phone_numbers table for ElevenLabs phone number management
CREATE TABLE public.phone_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  elevenlabs_phone_id TEXT NOT NULL UNIQUE,
  phone_number TEXT NOT NULL,
  country_code TEXT NOT NULL DEFAULT 'IL',
  status TEXT NOT NULL DEFAULT 'pending',
  monthly_cost DECIMAL(10,2),
  purchased_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS on phone_numbers
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;

-- RLS policies for phone_numbers
CREATE POLICY "Users can view their own phone numbers"
  ON public.phone_numbers
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own phone numbers"
  ON public.phone_numbers
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own phone numbers"
  ON public.phone_numbers
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own phone numbers"
  ON public.phone_numbers
  FOR DELETE
  USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_phone_numbers_updated_at
  BEFORE UPDATE ON public.phone_numbers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add new columns to scripts table for custom prompts
ALTER TABLE public.scripts 
  ADD COLUMN IF NOT EXISTS custom_prompt TEXT,
  ADD COLUMN IF NOT EXISTS greeting_message TEXT,
  ADD COLUMN IF NOT EXISTS voice_id TEXT;