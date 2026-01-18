-- Create subscription plans table
CREATE TABLE public.subscription_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_he TEXT NOT NULL,
  price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
  max_calls_per_month INTEGER NOT NULL DEFAULT 100,
  max_appointments_per_month INTEGER NOT NULL DEFAULT 50,
  max_scripts INTEGER NOT NULL DEFAULT 3,
  has_ai_agent BOOLEAN NOT NULL DEFAULT false,
  has_analytics BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Insert default plans
INSERT INTO public.subscription_plans (name, name_he, price_monthly, max_calls_per_month, max_appointments_per_month, max_scripts, has_ai_agent, has_analytics) VALUES
('Free', 'חינם', 0, 50, 20, 2, false, false),
('Basic', 'בסיסי', 99, 200, 100, 5, true, false),
('Pro', 'מקצועי', 199, 500, 300, 15, true, true),
('Enterprise', 'ארגוני', 399, -1, -1, -1, true, true);

-- Add subscription info to profiles
ALTER TABLE public.profiles 
ADD COLUMN subscription_plan_id UUID REFERENCES public.subscription_plans(id),
ADD COLUMN subscription_status TEXT DEFAULT 'active',
ADD COLUMN subscription_started_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN is_admin BOOLEAN DEFAULT false;

-- Set default plan for existing users
UPDATE public.profiles 
SET subscription_plan_id = (SELECT id FROM public.subscription_plans WHERE name = 'Free' LIMIT 1)
WHERE subscription_plan_id IS NULL;

-- Enable RLS on subscription_plans
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Everyone can view plans
CREATE POLICY "Anyone can view active plans" 
ON public.subscription_plans 
FOR SELECT 
USING (is_active = true);

-- Only admins can manage plans
CREATE POLICY "Admins can manage plans" 
ON public.subscription_plans 
FOR ALL 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
);

-- Create usage tracking table
CREATE TABLE public.usage_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month_year TEXT NOT NULL,
  calls_count INTEGER NOT NULL DEFAULT 0,
  appointments_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, month_year)
);

-- Enable RLS on usage_stats
ALTER TABLE public.usage_stats ENABLE ROW LEVEL SECURITY;

-- Users can view their own usage
CREATE POLICY "Users can view own usage" 
ON public.usage_stats 
FOR SELECT 
USING (auth.uid() = user_id);

-- Users can update their own usage
CREATE POLICY "Users can update own usage" 
ON public.usage_stats 
FOR ALL 
USING (auth.uid() = user_id);

-- Admins can view all usage
CREATE POLICY "Admins can view all usage" 
ON public.usage_stats 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE profiles.id = auth.uid() AND profiles.is_admin = true
  )
);