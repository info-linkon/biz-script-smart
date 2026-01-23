import { Check, Building2, FileText, Volume2, Phone, Headphones } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OnboardingStep } from '@/hooks/useOnboardingStatus';

interface OnboardingProgressProps {
  currentStep: OnboardingStep;
  completedSteps: {
    profile: boolean;
    script: boolean;
    voice: boolean;
    test: boolean;
    phone: boolean;
  };
}

const steps = [
  { id: 'profile' as const, label: 'פרטי עסק', icon: Building2 },
  { id: 'script' as const, label: 'תסריט', icon: FileText },
  { id: 'voice' as const, label: 'קול', icon: Volume2 },
  { id: 'test' as const, label: 'בדיקה', icon: Headphones },
  { id: 'phone' as const, label: 'מספר טלפון', icon: Phone },
];

export function OnboardingProgress({ currentStep, completedSteps }: OnboardingProgressProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="w-full py-6">
      <div className="flex items-center justify-between relative">
        {/* Progress line */}
        <div className="absolute top-5 left-0 right-0 h-0.5 bg-muted mx-12" />
        <div 
          className="absolute top-5 left-0 h-0.5 bg-primary mx-12 transition-all duration-500"
          style={{ 
            width: currentStep === 'done' 
              ? 'calc(100% - 6rem)' 
              : `calc(${(currentIndex / (steps.length - 1)) * 100}% - 3rem)` 
          }}
        />

        {steps.map((step, index) => {
          const isCompleted = completedSteps[step.id];
          const isCurrent = currentStep === step.id;
          const Icon = step.icon;

          return (
            <div 
              key={step.id} 
              className="flex flex-col items-center relative z-10"
            >
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                  isCompleted 
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25" 
                    : isCurrent 
                      ? "bg-primary/20 text-primary border-2 border-primary animate-pulse"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {isCompleted ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Icon className="h-5 w-5" />
                )}
              </div>
              <span 
                className={cn(
                  "mt-2 text-sm font-medium transition-colors",
                  isCurrent ? "text-primary" : isCompleted ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
