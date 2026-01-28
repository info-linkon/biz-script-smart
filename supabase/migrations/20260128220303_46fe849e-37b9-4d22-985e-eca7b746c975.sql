-- Fix call_metrics RLS: Remove overly permissive INSERT policy
DROP POLICY IF EXISTS "Allow insert for authenticated or service" ON public.call_metrics;

-- Create proper policy that restricts to user's own metrics
CREATE POLICY "Users can insert own metrics"
ON public.call_metrics
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Allow service role to insert metrics (for Edge Functions)
CREATE POLICY "Service can insert all metrics"
ON public.call_metrics
FOR INSERT TO service_role
WITH CHECK (true);

-- Create rate_limit_events table for monitoring
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id text,
  ip_address text,
  operation_type text NOT NULL,
  limit_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_user ON public.rate_limit_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_operation ON public.rate_limit_events(operation_type, created_at DESC);

-- RLS: Only admins can view
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view rate limit events"
ON public.rate_limit_events
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service can insert rate limit events"
ON public.rate_limit_events
FOR INSERT TO service_role
WITH CHECK (true);

-- Create billing_alerts table
CREATE TABLE IF NOT EXISTS public.billing_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  alert_type text NOT NULL,
  message text NOT NULL,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- RLS for billing_alerts
ALTER TABLE public.billing_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own alerts"
ON public.billing_alerts
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own alerts"
ON public.billing_alerts
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Service can insert alerts"
ON public.billing_alerts
FOR INSERT TO service_role
WITH CHECK (true);

-- Create system_health table for monitoring
CREATE TABLE IF NOT EXISTS public.system_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  active_calls integer DEFAULT 0,
  avg_ttfs_ms integer,
  avg_end_to_audio_ms integer,
  stt_success_rate numeric(5,2),
  tts_success_rate numeric(5,2),
  error_count integer DEFAULT 0,
  circuit_breaker_status jsonb DEFAULT '{}'
);

-- RLS for system_health - only admins
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view system health"
ON public.system_health
FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service can manage system health"
ON public.system_health
FOR ALL TO service_role
USING (true);

-- Auto-cleanup function for rate_limit_events (older than 7 days)
CREATE OR REPLACE FUNCTION public.cleanup_old_rate_limit_events()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.rate_limit_events 
  WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$;