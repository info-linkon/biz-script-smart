import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface SubscriptionPlan {
  id: string;
  name: string;
  name_he: string;
  price_monthly: number;
  max_calls_per_month: number;
  max_appointments_per_month: number;
  max_scripts: number;
  has_ai_agent: boolean;
  has_analytics: boolean;
}

interface UsageStats {
  calls_count: number;
  appointments_count: number;
}

interface SubscriptionData {
  plan: SubscriptionPlan | null;
  usage: UsageStats;
  loading: boolean;
  canMakeCall: () => boolean;
  canMakeAppointment: () => boolean;
  canCreateScript: (currentCount: number) => boolean;
  hasAIAgent: () => boolean;
  hasAnalytics: () => boolean;
  incrementCallCount: () => Promise<void>;
  incrementAppointmentCount: () => Promise<void>;
  getUsagePercentage: (type: 'calls' | 'appointments') => number;
}

export function useSubscription(): SubscriptionData {
  const { user } = useAuth();
  const [plan, setPlan] = useState<SubscriptionPlan | null>(null);
  const [usage, setUsage] = useState<UsageStats>({ calls_count: 0, appointments_count: 0 });
  const [loading, setLoading] = useState(true);

  const getCurrentMonthYear = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  };

  useEffect(() => {
    if (user) {
      fetchSubscriptionData();
    }
  }, [user]);

  const fetchSubscriptionData = async () => {
    if (!user) return;

    // Fetch user's plan
    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_plan_id')
      .eq('id', user.id)
      .single();

    if (profile?.subscription_plan_id) {
      const { data: planData } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', profile.subscription_plan_id)
        .single();

      if (planData) {
        setPlan(planData);
      }
    }

    // Fetch or create usage stats for current month
    const monthYear = getCurrentMonthYear();
    const { data: usageData } = await supabase
      .from('usage_stats')
      .select('*')
      .eq('user_id', user.id)
      .eq('month_year', monthYear)
      .single();

    if (usageData) {
      setUsage({
        calls_count: usageData.calls_count,
        appointments_count: usageData.appointments_count
      });
    } else {
      // Create new usage record for this month
      await supabase
        .from('usage_stats')
        .insert({
          user_id: user.id,
          month_year: monthYear,
          calls_count: 0,
          appointments_count: 0
        });
    }

    setLoading(false);
  };

  const canMakeCall = () => {
    if (!plan) return false;
    if (plan.max_calls_per_month === -1) return true;
    return usage.calls_count < plan.max_calls_per_month;
  };

  const canMakeAppointment = () => {
    if (!plan) return false;
    if (plan.max_appointments_per_month === -1) return true;
    return usage.appointments_count < plan.max_appointments_per_month;
  };

  const canCreateScript = (currentCount: number) => {
    if (!plan) return false;
    if (plan.max_scripts === -1) return true;
    return currentCount < plan.max_scripts;
  };

  const hasAIAgent = () => {
    return plan?.has_ai_agent ?? false;
  };

  const hasAnalytics = () => {
    return plan?.has_analytics ?? false;
  };

  const incrementCallCount = async () => {
    if (!user) return;
    
    const monthYear = getCurrentMonthYear();
    const newCount = usage.calls_count + 1;
    
    await supabase
      .from('usage_stats')
      .update({ calls_count: newCount, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('month_year', monthYear);

    setUsage(prev => ({ ...prev, calls_count: newCount }));
  };

  const incrementAppointmentCount = async () => {
    if (!user) return;
    
    const monthYear = getCurrentMonthYear();
    const newCount = usage.appointments_count + 1;
    
    await supabase
      .from('usage_stats')
      .update({ appointments_count: newCount, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('month_year', monthYear);

    setUsage(prev => ({ ...prev, appointments_count: newCount }));
  };

  const getUsagePercentage = (type: 'calls' | 'appointments') => {
    if (!plan) return 0;
    
    if (type === 'calls') {
      if (plan.max_calls_per_month === -1) return 0;
      return (usage.calls_count / plan.max_calls_per_month) * 100;
    }
    
    if (plan.max_appointments_per_month === -1) return 0;
    return (usage.appointments_count / plan.max_appointments_per_month) * 100;
  };

  return {
    plan,
    usage,
    loading,
    canMakeCall,
    canMakeAppointment,
    canCreateScript,
    hasAIAgent,
    hasAnalytics,
    incrementCallCount,
    incrementAppointmentCount,
    getUsagePercentage
  };
}
