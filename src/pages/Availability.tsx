import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Clock, Loader2, Save, RefreshCw } from 'lucide-react';

interface DayAvailability {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_available: boolean;
}

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const DEFAULT_AVAILABILITY: DayAvailability[] = [
  { day_of_week: 0, start_time: '09:00', end_time: '17:00', is_available: true },
  { day_of_week: 1, start_time: '09:00', end_time: '17:00', is_available: true },
  { day_of_week: 2, start_time: '09:00', end_time: '17:00', is_available: true },
  { day_of_week: 3, start_time: '09:00', end_time: '17:00', is_available: true },
  { day_of_week: 4, start_time: '09:00', end_time: '17:00', is_available: true },
  { day_of_week: 5, start_time: '09:00', end_time: '13:00', is_available: true },
  { day_of_week: 6, start_time: '09:00', end_time: '17:00', is_available: false },
];

export default function AvailabilityPage() {
  const { user } = useAuth();
  const [availability, setAvailability] = useState<DayAvailability[]>(DEFAULT_AVAILABILITY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (user) {
      fetchAvailability();
    }
  }, [user]);

  const fetchAvailability = async () => {
    try {
      const { data, error } = await supabase
        .from('availability')
        .select('*')
        .order('day_of_week', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        // Merge with defaults for any missing days
        const mergedAvailability = DEFAULT_AVAILABILITY.map(defaultDay => {
          const existingDay = data.find(d => d.day_of_week === defaultDay.day_of_week);
          return existingDay || defaultDay;
        });
        setAvailability(mergedAvailability);
      }
    } catch (error) {
      console.error('Error fetching availability:', error);
      toast.error('שגיאה בטעינת הזמינות');
    } finally {
      setLoading(false);
    }
  };

  const updateDayAvailability = (dayIndex: number, field: keyof DayAvailability, value: string | boolean) => {
    setAvailability(prev => prev.map((day, i) => 
      i === dayIndex ? { ...day, [field]: value } : day
    ));
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!user) return;

    setSaving(true);

    try {
      // Delete existing availability
      await supabase
        .from('availability')
        .delete()
        .eq('user_id', user.id);

      // Insert new availability
      const { error } = await supabase
        .from('availability')
        .insert(
          availability.map(day => ({
            user_id: user.id,
            day_of_week: day.day_of_week,
            start_time: day.start_time,
            end_time: day.end_time,
            is_available: day.is_available,
          }))
        );

      if (error) throw error;

      toast.success('הזמינות נשמרה בהצלחה');
      setHasChanges(false);
      fetchAvailability();
    } catch (error) {
      console.error('Error saving availability:', error);
      toast.error('שגיאה בשמירת הזמינות');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = () => {
    setAvailability(DEFAULT_AVAILABILITY);
    setHasChanges(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">ניהול זמינות</h1>
            <p className="text-muted-foreground">הגדר את שעות הפעילות שלך לכל יום בשבוע</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={resetToDefaults}
              disabled={saving}
            >
              <RefreshCw className="ml-2 h-4 w-4" />
              איפוס לברירת מחדל
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="gradient-primary text-white"
            >
              {saving ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                <>
                  <Save className="ml-2 h-4 w-4" />
                  שמור שינויים
                </>
              )}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="grid gap-4">
            {availability.map((day, index) => (
              <Card 
                key={day.day_of_week} 
                className={`border-0 shadow-sm transition-opacity ${!day.is_available ? 'opacity-60' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                    {/* Day Name & Toggle */}
                    <div className="flex items-center justify-between sm:justify-start gap-4 min-w-[140px]">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={day.is_available}
                          onCheckedChange={(checked) => updateDayAvailability(index, 'is_available', checked)}
                        />
                        <span className="font-semibold text-lg">{DAY_NAMES[day.day_of_week]}</span>
                      </div>
                    </div>

                    {/* Time Inputs */}
                    {day.is_available && (
                      <div className="flex items-center gap-4 flex-1">
                        <div className="flex items-center gap-2 flex-1">
                          <Label htmlFor={`start-${index}`} className="text-sm text-muted-foreground whitespace-nowrap">
                            מ-
                          </Label>
                          <Input
                            id={`start-${index}`}
                            type="time"
                            value={day.start_time}
                            onChange={(e) => updateDayAvailability(index, 'start_time', e.target.value)}
                            className="w-full max-w-[120px]"
                            dir="ltr"
                          />
                        </div>
                        <div className="flex items-center gap-2 flex-1">
                          <Label htmlFor={`end-${index}`} className="text-sm text-muted-foreground whitespace-nowrap">
                            עד
                          </Label>
                          <Input
                            id={`end-${index}`}
                            type="time"
                            value={day.end_time}
                            onChange={(e) => updateDayAvailability(index, 'end_time', e.target.value)}
                            className="w-full max-w-[120px]"
                            dir="ltr"
                          />
                        </div>
                        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
                          <Clock className="h-4 w-4" />
                          <span>
                            {(() => {
                              const [startH, startM] = day.start_time.split(':').map(Number);
                              const [endH, endM] = day.end_time.split(':').map(Number);
                              const totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
                              const hours = Math.floor(totalMinutes / 60);
                              const minutes = totalMinutes % 60;
                              return totalMinutes > 0 
                                ? `${hours}:${minutes.toString().padStart(2, '0')} שעות`
                                : 'לא תקין';
                            })()}
                          </span>
                        </div>
                      </div>
                    )}

                    {!day.is_available && (
                      <div className="flex-1 text-muted-foreground text-sm">
                        סגור
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info Card */}
        <Card className="border-0 shadow-sm bg-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4" />
              מידע חשוב
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>• הגדרות הזמינות משפיעות על סוכן ה-AI שלך - הוא ידע מתי אתה פנוי לפגישות</p>
            <p>• כאשר יום מוגדר כ"סגור", הסוכן לא יציע ללקוחות פגישות באותו יום</p>
            <p>• ניתן להגדיר שעות שונות לכל יום בשבוע</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
