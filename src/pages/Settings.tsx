import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { User, Building2, Phone, MapPin, Loader2, Save, Volume2 } from 'lucide-react';
import { PhoneNumberManager } from '@/components/phone/PhoneNumberManager';
import { VoiceSelector } from '@/components/phone/VoiceSelector';

interface Profile {
  business_name: string | null;
  business_type: string | null;
  phone: string | null;
  address: string | null;
  elevenlabs_agent_id: string | null;
}

export default function Settings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile>({
    business_name: '',
    business_type: '',
    phone: '',
    address: '',
    elevenlabs_agent_id: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user!.id)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      
      if (data) {
        setProfile({
          business_name: data.business_name || '',
          business_type: data.business_type || '',
          phone: data.phone || '',
          address: data.address || '',
          elevenlabs_agent_id: data.elevenlabs_agent_id || null,
        });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          business_name: profile.business_name || null,
          business_type: profile.business_type || null,
          phone: profile.phone || null,
          address: profile.address || null,
        })
        .eq('user_id', user!.id);

      if (error) throw error;
      
      toast.success('ההגדרות נשמרו בהצלחה');
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('שגיאה בשמירת ההגדרות');
    } finally {
      setSaving(false);
    }
  };

  const handleVoiceChange = async (voiceId: string) => {
    setSelectedVoiceId(voiceId);
    
    if (!profile.elevenlabs_agent_id) {
      toast.error('יש לרכוש מספר טלפון קודם כדי לשנות קול');
      return;
    }

    setSavingVoice(true);

    try {
      // Get user's active script to update the agent
      const { data: scripts } = await supabase
        .from('scripts')
        .select('id')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .limit(1);

      const scriptId = scripts?.[0]?.id;

      if (!scriptId) {
        toast.error('יש ליצור תסריט פעיל קודם');
        setSavingVoice(false);
        return;
      }

      // Call update agent with new voice
      const { data, error } = await supabase.functions.invoke('elevenlabs-update-agent', {
        body: { 
          script_id: scriptId,
          voice_id: voiceId 
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('קול הסוכן עודכן בהצלחה');
      } else {
        throw new Error(data?.error || 'Failed to update voice');
      }
    } catch (error) {
      console.error('Error updating voice:', error);
      toast.error('שגיאה בעדכון הקול');
    } finally {
      setSavingVoice(false);
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-2xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">הגדרות</h1>
          <p className="text-muted-foreground">ניהול פרטי העסק והחשבון</p>
        </div>

        {/* Profile Settings */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              פרטי העסק
            </CardTitle>
            <CardDescription>
              המידע הזה ישמש את הסוכן כדי לענות ללקוחות
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="businessName">שם העסק</Label>
                  <div className="relative">
                    <Building2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="businessName"
                      placeholder="למשל: מספרת הזהב"
                      value={profile.business_name || ''}
                      onChange={(e) => setProfile({ ...profile, business_name: e.target.value })}
                      className="pr-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="businessType">סוג העסק</Label>
                  <Input
                    id="businessType"
                    placeholder="למשל: מספרה, מסעדה, קליניקה"
                    value={profile.business_type || ''}
                    onChange={(e) => setProfile({ ...profile, business_type: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">טלפון</Label>
                  <div className="relative">
                    <Phone className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="phone"
                      type="tel"
                      placeholder="03-1234567"
                      value={profile.phone || ''}
                      onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      className="pr-10"
                      dir="ltr"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="address">כתובת</Label>
                  <div className="relative">
                    <MapPin className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="address"
                      placeholder="רחוב, עיר"
                      value={profile.address || ''}
                      onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                      className="pr-10"
                    />
                  </div>
                </div>

                <Button type="submit" disabled={saving} className="w-full gradient-primary text-white">
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
              </form>
            )}
          </CardContent>
        </Card>

        {/* Phone Number Management */}
        <PhoneNumberManager />

        {/* Voice Settings */}
        {profile.elevenlabs_agent_id && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Volume2 className="h-5 w-5 text-primary" />
                קול הסוכן
              </CardTitle>
              <CardDescription>
                בחר את הקול שבו הסוכן ידבר עם הלקוחות
              </CardDescription>
            </CardHeader>
            <CardContent>
              {savingVoice && (
                <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מעדכן את הקול...
                </div>
              )}
              <VoiceSelector 
                selectedVoiceId={selectedVoiceId} 
                onSelect={handleVoiceChange}
              />
            </CardContent>
          </Card>
        )}

        {/* Account Info */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              פרטי חשבון
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <Label className="text-muted-foreground">אימייל</Label>
                <p className="font-medium" dir="ltr">{user?.email}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">מזהה משתמש</Label>
                <p className="font-mono text-sm text-muted-foreground" dir="ltr">
                  {user?.id.slice(0, 8)}...
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
