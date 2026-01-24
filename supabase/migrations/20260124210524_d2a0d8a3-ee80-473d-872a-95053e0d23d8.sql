-- Create call_metrics table for telemetry tracking
CREATE TABLE public.call_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sid TEXT NOT NULL,
  user_id UUID NOT NULL,
  ttfs_ms INTEGER,
  end_to_audio_ms INTEGER,
  barge_in_count INTEGER DEFAULT 0,
  faq_hit_count INTEGER DEFAULT 0,
  stt_failures INTEGER DEFAULT 0,
  total_turns INTEGER DEFAULT 0,
  avg_turn_duration_ms INTEGER,
  languages_detected TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.call_metrics ENABLE ROW LEVEL SECURITY;

-- Users can view their own metrics
CREATE POLICY "Users can view own metrics"
  ON public.call_metrics FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can view all metrics
CREATE POLICY "Admins can view all metrics"
  ON public.call_metrics FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Service role / edge functions can insert (no auth context)
CREATE POLICY "Allow insert for authenticated or service"
  ON public.call_metrics FOR INSERT
  WITH CHECK (true);

-- Create index for faster queries
CREATE INDEX idx_call_metrics_user_id ON public.call_metrics(user_id);
CREATE INDEX idx_call_metrics_created_at ON public.call_metrics(created_at DESC);