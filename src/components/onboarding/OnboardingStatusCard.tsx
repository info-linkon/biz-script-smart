import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useOnboardingStatus } from '@/hooks/useOnboardingStatus';
import { Building2, FileText, Volume2, Phone, Check, ArrowLeft, Sparkles } from 'lucide-react';

export function OnboardingStatusCard() {
  const navigate = useNavigate();
  const { 
    isLoading, 
    isComplete, 
    currentStep,
    hasBusinessProfile,
    hasActiveScript,
    hasVoiceSelected,
    hasPhoneNumber,
  } = useOnboardingStatus();

  if (isLoading) {
    return null;
  }

  if (isComplete) {
    return null; // Don't show if onboarding is complete
  }

  const steps = [
    { id: 'profile', label: 'פרטי עסק', done: hasBusinessProfile, icon: Building2 },
    { id: 'script', label: 'תסריט', done: hasActiveScript, icon: FileText },
    { id: 'voice', label: 'קול', done: hasVoiceSelected, icon: Volume2 },
    { id: 'phone', label: 'מספר טלפון', done: hasPhoneNumber, icon: Phone },
  ];

  const completedCount = steps.filter(s => s.done).length;
  const progress = (completedCount / steps.length) * 100;

  return (
    <Card className="border-primary/20 bg-primary/5 shadow-lg">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">השלם את ההגדרה</CardTitle>
          </div>
          <span className="text-sm text-muted-foreground">
            {completedCount} מתוך {steps.length}
          </span>
        </div>
        <CardDescription>
          השלם את כל השלבים להפעלת הסוכן הקולי שלך
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={progress} className="h-2" />
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div
                key={step.id}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg transition-colors ${
                  step.done 
                    ? 'bg-primary/10 text-primary' 
                    : currentStep === step.id 
                      ? 'bg-primary/5 text-primary border border-primary/30'
                      : 'bg-muted/50 text-muted-foreground'
                }`}
              >
                <div className={`h-8 w-8 rounded-full flex items-center justify-center ${
                  step.done ? 'bg-primary text-primary-foreground' : 'bg-background'
                }`}>
                  {step.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                <span className="text-xs font-medium">{step.label}</span>
              </div>
            );
          })}
        </div>

        <Button 
          onClick={() => navigate('/onboarding')} 
          className="w-full gradient-primary text-white"
        >
          המשך הגדרה
          <ArrowLeft className="mr-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
