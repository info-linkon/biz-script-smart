-- Add twilio_sid column to phone_numbers table
ALTER TABLE public.phone_numbers ADD COLUMN IF NOT EXISTS twilio_sid TEXT;