import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOnboardingStatus, OnboardingStep } from '@/hooks/useOnboardingStatus';
import { OnboardingProgress } from '@/components/onboarding/OnboardingProgress';
import { ProfileStep } from '@/components/onboarding/steps/ProfileStep';
import { PlanStep } from '@/components/onboarding/steps/PlanStep';
import { ScriptStep } from '@/components/onboarding/steps/ScriptStep';
import { VoiceStep } from '@/components/onboarding/steps/VoiceStep';
import { AgentTestStep } from '@/components/onboarding/steps/AgentTestStep';
import { PhoneStep } from '@/components/onboarding/steps/PhoneStep';
import { Loader2, Mic } from 'lucide-react';

export default function Onboarding() {
  const navigate = useNavigate();
  const { 
    isLoading, 
    isComplete, 
    currentStep: statusStep,
    hasBusinessProfile,
    hasPlanSelected,
    hasActiveScript,
    hasVoiceSelected,
    hasPhoneNumber,
    profile,
    activeScript,
    refetch,
  } = useOnboardingStatus();

  const [currentStep, setCurrentStep] = useState<OnboardingStep>('profile');

  // Sync with status on load
  useEffect(() => {
    if (!isLoading && statusStep !== 'done') {
      setCurrentStep(statusStep);
    }
  }, [isLoading, statusStep]);

  // Redirect to dashboard if onboarding is complete
  useEffect(() => {
    if (!isLoading && isComplete) {
      navigate('/dashboard', { replace: true });
    }
  }, [isLoading, isComplete, navigate]);

  const handleStepComplete = async (nextStep: OnboardingStep) => {
    await refetch();
    
    if (nextStep === 'done') {
      navigate('/dashboard', { replace: true });
    } else {
      setCurrentStep(nextStep);
    }
  };

  const handleBack = (prevStep: OnboardingStep) => {
    setCurrentStep(prevStep);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/5">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasAgent = !!((profile as any)?.dialogflow_agent_id);
  
  const completedSteps = {
    profile: hasBusinessProfile,
    plan: hasPlanSelected,
    script: hasActiveScript,
    voice: hasVoiceSelected,
    test: hasAgent,
    phone: hasPhoneNumber,
  };

  return (
    <div dir="rtl" className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-2xl mx-auto px-4 py-8">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2">
            <div className="h-10 w-10 rounded-xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/25">
              <Mic className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">AI Voice Agent</span>
          </div>
        </div>

        {/* Progress */}
        <OnboardingProgress 
          currentStep={currentStep} 
          completedSteps={completedSteps} 
        />

        {/* Step Content */}
        <div className="mt-8 animate-fade-in">
          {currentStep === 'profile' && (
            <ProfileStep
              initialData={profile}
              onComplete={() => handleStepComplete('plan')}
            />
          )}
          
          {currentStep === 'plan' && (
            <PlanStep
              onComplete={() => handleStepComplete('script')}
              onBack={() => handleBack('profile')}
            />
          )}
          
          {currentStep === 'script' && (
            <ScriptStep
              initialData={activeScript}
              onComplete={() => handleStepComplete('voice')}
              onBack={() => handleBack('plan')}
            />
          )}
          
          {currentStep === 'voice' && (
            <VoiceStep
              initialVoiceId={activeScript?.voice_id}
              onComplete={() => handleStepComplete('test')}
              onBack={() => handleBack('script')}
            />
          )}
          
          {currentStep === 'test' && (
            <AgentTestStep
              onComplete={() => handleStepComplete('phone')}
              onBack={() => handleBack('voice')}
            />
          )}
          
          {currentStep === 'phone' && (
            <PhoneStep
              onComplete={() => handleStepComplete('done')}
              onBack={() => handleBack('test')}
            />
          )}
        </div>
      </div>
    </div>
  );
}
