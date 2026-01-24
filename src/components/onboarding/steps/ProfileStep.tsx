import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Building2, ArrowLeft, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface ProfileStepProps {
  initialData?: {
    business_name: string | null;
    business_type: string | null;
    phone: string | null;
    address: string | null;
  } | null;
  onComplete: () => void;
}

const businessTypes = [
  { value: 'restaurant', label: 'מסעדה / בית קפה' },
  { value: 'medical', label: 'קליניקה / מרפאה' },
  { value: 'beauty', label: 'יופי וטיפוח' },
  { value: 'fitness', label: 'כושר / ספורט' },
  { value: 'legal', label: 'משרד עורכי דין' },
  { value: 'accounting', label: 'רואה חשבון' },
  { value: 'real_estate', label: 'נדל"ן' },
  { value: 'automotive', label: 'רכב / מוסך' },
  { value: 'education', label: 'חינוך / הדרכה' },
  { value: 'retail', label: 'קמעונאות' },
  { value: 'services', label: 'שירותים אחרים' },
];

export function ProfileStep({ initialData, onComplete }: ProfileStepProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    business_name: initialData?.business_name || '',
    business_type: initialData?.business_type || '',
    phone: initialData?.phone || '',
    address: initialData?.address || '',
  });

  useEffect(() => {
    if (initialData) {
      setFormData({
        business_name: initialData.business_name || '',
        business_type: initialData.business_type || '',
        phone: initialData.phone || '',
        address: initialData.address || '',
      });
    }
  }, [initialData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.business_name.trim()) {
      toast.error('שם העסק הוא שדה חובה');
      return;
    }

    if (!formData.business_type) {
      toast.error('סוג העסק הוא שדה חובה');
      return;
    }

    if (!user) return;

    setSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          business_name: formData.business_name.trim(),
          business_type: formData.business_type,
          phone: formData.phone.trim() || null,
          address: formData.address.trim() || null,
          voice_provider: 'google',
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id);

      if (error) throw error;

      toast.success('פרטי העסק נשמרו בהצלחה');
      onComplete();
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('שגיאה בשמירת הפרטים');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Building2 className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">פרטי העסק שלך</CardTitle>
        <CardDescription>
          ספר לנו על העסק שלך כדי שנוכל להתאים את הסוכן הקולי
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="business_name">שם העסק *</Label>
            <Input
              id="business_name"
              placeholder="לדוגמה: מסעדת האושר"
              value={formData.business_name}
              onChange={(e) => setFormData(prev => ({ ...prev, business_name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="business_type">סוג העסק *</Label>
            <Select
              value={formData.business_type}
              onValueChange={(value) => setFormData(prev => ({ ...prev, business_type: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="בחר סוג עסק" />
              </SelectTrigger>
              <SelectContent>
                {businessTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="phone">טלפון העסק</Label>
            <Input
              id="phone"
              type="tel"
              placeholder="050-1234567"
              value={formData.phone}
              onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
              dir="ltr"
              className="text-left"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">כתובת העסק</Label>
            <Input
              id="address"
              placeholder="רחוב, עיר"
              value={formData.address}
              onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
            />
          </div>

          <Button
            type="submit"
            className="w-full gradient-primary text-white"
            disabled={saving}
          >
            {saving ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                שומר...
              </>
            ) : (
              <>
                המשך לשלב הבא
                <ArrowLeft className="mr-2 h-4 w-4" />
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
