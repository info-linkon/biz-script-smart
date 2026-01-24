-- Add agent voice gender column to scripts table
ALTER TABLE public.scripts ADD COLUMN IF NOT EXISTS agent_voice_gender TEXT DEFAULT 'female';