import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export type OnboardingStep = 'profile' | 'plan' | 'script' | 'voice' | 'test' | 'phone' | 'done';

export interface OnboardingStatus {
  isComplete: boolean;
  isLoading: boolean;
  currentStep: OnboardingStep;
  hasBusinessProfile: boolean;
  hasPlanSelected: boolean;
  hasActiveScript: boolean;
  hasVoiceSelected: boolean;
  hasPhoneNumber: boolean;
  hasAgent: boolean;
  profile: {
    business_name: string | null;
    business_type: string | null;
    phone: string | null;
    address: string | null;
    elevenlabs_agent_id: string | null;
    subscription_plan_id: string | null;
  } | null;
  activeScript: {
    id: string;
    name: string;
    voice_id: string | null;
    services: string[] | null;
    business_hours: string | null;
  } | null;
  phoneNumber: {
    phone_number: string;
    status: string;
    is_active: boolean;
  } | null;
  refetch: () => Promise<void>;
}

export function useOnboardingStatus(): OnboardingStatus {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<OnboardingStatus['profile']>(null);
  const [activeScript, setActiveScript] = useState<OnboardingStatus['activeScript']>(null);
  const [phoneNumber, setPhoneNumber] = useState<OnboardingStatus['phoneNumber']>(null);

  const fetchStatus = async () => {
    if (!user) {
      setIsLoading(false);
      return;
    }

    try {
      // Fetch profile, scripts, and phone numbers in parallel
      const [profileRes, scriptsRes, phoneRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('business_name, business_type, phone, address, elevenlabs_agent_id, subscription_plan_id')
          .eq('user_id', user.id)
          .single(),
        supabase
          .from('scripts')
          .select('id, name, voice_id, services, business_hours')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('phone_numbers')
          .select('phone_number, status, is_active')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .maybeSingle(),
      ]);

      if (profileRes.data) {
        setProfile(profileRes.data);
      }

      if (scriptsRes.data) {
        setActiveScript(scriptsRes.data);
      } else {
        setActiveScript(null);
      }

      if (phoneRes.data) {
        setPhoneNumber(phoneRes.data);
      } else {
        setPhoneNumber(null);
      }
    } catch (error) {
      console.error('Error fetching onboarding status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [user]);

  // Calculate status flags
  const hasBusinessProfile = !!(profile?.business_name && profile?.business_type);
  const hasPlanSelected = !!(profile?.subscription_plan_id);
  const hasActiveScript = !!activeScript;
  const hasVoiceSelected = !!(activeScript?.voice_id);
  const hasPhoneNumber = !!(phoneNumber?.is_active);
  const hasAgent = !!(profile?.elevenlabs_agent_id);

  // Determine current step
  let currentStep: OnboardingStep = 'profile';
  if (hasBusinessProfile) {
    currentStep = 'plan';
    if (hasPlanSelected) {
      currentStep = 'script';
      if (hasActiveScript) {
        currentStep = 'voice';
        if (hasVoiceSelected) {
          currentStep = 'test';
          if (hasAgent) {
            currentStep = 'phone';
            if (hasPhoneNumber) {
              currentStep = 'done';
            }
          }
        }
      }
    }
  }

  const isComplete = currentStep === 'done';

  return {
    isComplete,
    isLoading,
    currentStep,
    hasBusinessProfile,
    hasPlanSelected,
    hasActiveScript,
    hasVoiceSelected,
    hasPhoneNumber,
    hasAgent,
    profile,
    activeScript,
    phoneNumber,
    refetch: fetchStatus,
  };
}
