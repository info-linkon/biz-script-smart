-- Add dialogflow_agent_id column to profiles table for Google Dialogflow CX integration
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS dialogflow_agent_id text;