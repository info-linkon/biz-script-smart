-- Add phone_number column to profiles if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'profiles' 
    AND column_name = 'phone_number'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN phone_number text;
  END IF;
END $$;

-- Update stale call statuses (in-progress calls older than 10 minutes should be marked as completed)
UPDATE public.calls 
SET status = 'completed' 
WHERE status = 'in-progress' 
AND created_at < NOW() - INTERVAL '10 minutes';