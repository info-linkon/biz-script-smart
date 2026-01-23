import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  CreditCard, 
  Check, 
  Loader2, 
  ArrowLeft, 
  Phone, 
  Calendar, 
  FileText, 
  Bot, 
  BarChart3,
  Sparkles
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface Plan {
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

interface PlanStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function PlanStep({ onComplete, onBack }: PlanStepProps) {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [currentPlanId, setCurrentPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchPlans();
    fetchCurrentPlan();
  }, [user]);

  const fetchPlans = async () => {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true });

    if (!error && data) {
      setPlans(data);
    }
    setLoading(false);
  };

  const fetchCurrentPlan = async () => {
    if (!user) return;
    
    const { data } = await supabase
      .from('profiles')
      .select('subscription_plan_id')
      .eq('user_id', user.id)
      .single();

    if (data?.subscription_plan_id) {
      setCurrentPlanId(data.subscription_plan_id);
      setSelectedPlan(data.subscription_plan_id);
    }
  };

  const handleSelectPlan = async () => {
    if (!selectedPlan || !user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          subscription_plan_id: selectedPlan,
          subscription_status: 'active',
          subscription_started_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('התוכנית נבחרה בהצלחה!');
      onComplete();
    } catch (error) {
      console.error('Error selecting plan:', error);
      toast.error('שגיאה בבחירת התוכנית');
    } finally {
      setSaving(false);
    }
  };

  const formatLimit = (limit: number) => {
    if (limit === -1) return 'ללא הגבלה';
    return limit.toString();
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-xl">
        <CardContent className="py-12 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-xl">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto w-16 h-16 rounded-2xl gradient-primary flex items-center justify-center mb-4 shadow-lg shadow-primary/25">
          <CreditCard className="h-8 w-8 text-white" />
        </div>
        <CardTitle className="text-2xl">בחר תוכנית</CardTitle>
        <CardDescription className="text-base">
          בחר את התוכנית המתאימה לעסק שלך
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <div className="grid gap-4">
          {plans.map((plan) => {
            const isSelected = selectedPlan === plan.id;
            const isFree = plan.price_monthly === 0;
            const isPopular = plan.name === 'Pro';
            
            return (
              <div
                key={plan.id}
                onClick={() => setSelectedPlan(plan.id)}
                className={cn(
                  "relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                    : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}
              >
                {isPopular && (
                  <Badge className="absolute -top-2 right-4 bg-gradient-to-r from-primary to-accent">
                    <Sparkles className="h-3 w-3 ml-1" />
                    מומלץ
                  </Badge>
                )}
                
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-bold">{plan.name_he}</h3>
                      {isFree && (
                        <Badge variant="secondary">חינם</Badge>
                      )}
                    </div>
                    
                    <div className="flex items-baseline gap-1 mb-3">
                      <span className="text-3xl font-bold">₪{plan.price_monthly}</span>
                      <span className="text-muted-foreground">/חודש</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="h-4 w-4" />
                        <span>{formatLimit(plan.max_calls_per_month)} שיחות</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Calendar className="h-4 w-4" />
                        <span>{formatLimit(plan.max_appointments_per_month)} פגישות</span>
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <FileText className="h-4 w-4" />
                        <span>{formatLimit(plan.max_scripts)} תסריטים</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4" />
                        <span className={plan.has_ai_agent ? 'text-green-600' : 'text-muted-foreground'}>
                          {plan.has_ai_agent ? 'סוכן AI' : 'ללא סוכן'}
                        </span>
                      </div>
                      {plan.has_analytics && (
                        <div className="flex items-center gap-2 text-green-600">
                          <BarChart3 className="h-4 w-4" />
                          <span>אנליטיקס</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className={cn(
                    "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/30"
                  )}>
                    {isSelected && <Check className="h-4 w-4 text-white" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4 ml-2" />
            חזור
          </Button>
          <Button
            onClick={handleSelectPlan}
            disabled={!selectedPlan || saving}
            className="flex-1 gradient-primary text-white"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                שומר...
              </>
            ) : (
              <>
                המשך
                <Check className="h-4 w-4 mr-2" />
              </>
            )}
          </Button>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          * ניתן לשדרג או לשנות תוכנית בכל עת דרך ההגדרות
        </p>
      </CardContent>
    </Card>
  );
}
