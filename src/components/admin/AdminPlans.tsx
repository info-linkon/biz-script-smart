import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  CreditCard, 
  Edit,
  Check,
  X
} from 'lucide-react';

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
  is_active: boolean;
}

interface AdminPlansProps {
  plans: Plan[];
  onRefresh: () => void;
}

export function AdminPlans({ plans, onRefresh }: AdminPlansProps) {
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showPlanDialog, setShowPlanDialog] = useState(false);

  const handleUpdatePlan = async () => {
    if (!editingPlan) return;

    const { error } = await supabase
      .from('subscription_plans')
      .update({
        name: editingPlan.name,
        name_he: editingPlan.name_he,
        price_monthly: editingPlan.price_monthly,
        max_calls_per_month: editingPlan.max_calls_per_month,
        max_appointments_per_month: editingPlan.max_appointments_per_month,
        max_scripts: editingPlan.max_scripts,
        has_ai_agent: editingPlan.has_ai_agent,
        has_analytics: editingPlan.has_analytics,
        is_active: editingPlan.is_active
      })
      .eq('id', editingPlan.id);

    if (error) {
      toast.error('שגיאה בעדכון התוכנית');
    } else {
      toast.success('התוכנית עודכנה בהצלחה');
      setShowPlanDialog(false);
      onRefresh();
    }
  };

  const formatLimit = (value: number) => {
    return value === -1 ? 'ללא הגבלה' : value.toString();
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            תוכניות מנוי
          </CardTitle>
          <CardDescription>ניהול תוכניות ומחירים</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {plans.map(plan => (
              <Card 
                key={plan.id} 
                className={`relative ${!plan.is_active ? 'opacity-60 bg-muted/50' : ''}`}
              >
                {!plan.is_active && (
                  <Badge 
                    variant="secondary" 
                    className="absolute top-2 left-2"
                  >
                    לא פעיל
                  </Badge>
                )}
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{plan.name_he}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingPlan(plan);
                        setShowPlanDialog(true);
                      }}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription className="text-xl font-bold text-primary">
                    ₪{plan.price_monthly}/חודש
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">שיחות:</span>
                      <span>{formatLimit(plan.max_calls_per_month)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">פגישות:</span>
                      <span>{formatLimit(plan.max_appointments_per_month)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">תסריטים:</span>
                      <span>{formatLimit(plan.max_scripts)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    {plan.has_ai_agent && (
                      <Badge variant="secondary" className="text-xs">
                        <Check className="h-3 w-3 ml-1" />
                        AI
                      </Badge>
                    )}
                    {plan.has_analytics && (
                      <Badge variant="secondary" className="text-xs">
                        <Check className="h-3 w-3 ml-1" />
                        ניתוח
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Edit Plan Dialog */}
      <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>עריכת תוכנית</DialogTitle>
            <DialogDescription>עדכן את פרטי התוכנית</DialogDescription>
          </DialogHeader>
          {editingPlan && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>שם באנגלית</Label>
                  <Input
                    value={editingPlan.name}
                    onChange={(e) => setEditingPlan({...editingPlan, name: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <Label>שם בעברית</Label>
                  <Input
                    value={editingPlan.name_he}
                    onChange={(e) => setEditingPlan({...editingPlan, name_he: e.target.value})}
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>מחיר חודשי (₪)</Label>
                <Input
                  type="number"
                  value={editingPlan.price_monthly}
                  onChange={(e) => setEditingPlan({...editingPlan, price_monthly: parseFloat(e.target.value)})}
                />
              </div>
              
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>מקס' שיחות</Label>
                  <Input
                    type="number"
                    value={editingPlan.max_calls_per_month}
                    onChange={(e) => setEditingPlan({...editingPlan, max_calls_per_month: parseInt(e.target.value)})}
                  />
                  <p className="text-xs text-muted-foreground">-1 = ללא הגבלה</p>
                </div>
                <div className="space-y-2">
                  <Label>מקס' פגישות</Label>
                  <Input
                    type="number"
                    value={editingPlan.max_appointments_per_month}
                    onChange={(e) => setEditingPlan({...editingPlan, max_appointments_per_month: parseInt(e.target.value)})}
                  />
                  <p className="text-xs text-muted-foreground">-1 = ללא הגבלה</p>
                </div>
                <div className="space-y-2">
                  <Label>מקס' תסריטים</Label>
                  <Input
                    type="number"
                    value={editingPlan.max_scripts}
                    onChange={(e) => setEditingPlan({...editingPlan, max_scripts: parseInt(e.target.value)})}
                  />
                  <p className="text-xs text-muted-foreground">-1 = ללא הגבלה</p>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <Label>סוכן AI</Label>
                  <Switch
                    checked={editingPlan.has_ai_agent}
                    onCheckedChange={(checked) => setEditingPlan({...editingPlan, has_ai_agent: checked})}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>ניתוח נתונים</Label>
                  <Switch
                    checked={editingPlan.has_analytics}
                    onCheckedChange={(checked) => setEditingPlan({...editingPlan, has_analytics: checked})}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label>תוכנית פעילה</Label>
                  <Switch
                    checked={editingPlan.is_active}
                    onCheckedChange={(checked) => setEditingPlan({...editingPlan, is_active: checked})}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPlanDialog(false)}>
              ביטול
            </Button>
            <Button onClick={handleUpdatePlan}>
              שמור שינויים
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
