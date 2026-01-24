import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FileText, ArrowLeft, ArrowRight, Loader2, Plus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface ScriptStepProps {
  initialData?: {
    id: string;
    name: string;
    voice_id: string | null;
    services: string[] | null;
    business_hours: string | null;
  } | null;
  onComplete: () => void;
  onBack: () => void;
}

const toneOptions = [
  { value: 'friendly', label: 'ידידותי וחם' },
  { value: 'professional', label: 'מקצועי ורשמי' },
  { value: 'casual', label: 'קליל ונינוח' },
  { value: 'energetic', label: 'אנרגטי ונמרץ' },
];

export function ScriptStep({ initialData, onComplete, onBack }: ScriptStepProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: initialData?.name || 'תסריט ראשי',
    greeting_message: '',
    business_hours: initialData?.business_hours || '',
    services: initialData?.services || [] as string[],
    tone: 'friendly',
    newService: '',
  });
  const [existingScriptId, setExistingScriptId] = useState<string | null>(initialData?.id || null);

  useEffect(() => {
    // Load existing script data if available
    const loadScript = async () => {
      if (!user) return;
      
      const { data } = await supabase
        .from('scripts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (data) {
        setExistingScriptId(data.id);
        setFormData({
          name: data.name,
          greeting_message: data.greeting_message || '',
          business_hours: data.business_hours || '',
          services: data.services || [],
          tone: data.tone || 'friendly',
          newService: '',
        });
      }
    };

    if (!initialData) {
      loadScript();
    }
  }, [user, initialData]);

  const addService = () => {
    if (formData.newService.trim()) {
      setFormData(prev => ({
        ...prev,
        services: [...prev.services, prev.newService.trim()],
        newService: '',
      }));
    }
  };

  const removeService = (index: number) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.filter((_, i) => i !== index),
    }));
  };

  const syncAgentWithScript = async (scriptId: string) => {
    try {
      // Get session for auth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Get user profile to check if agent exists
      const { data: profile } = await supabase
        .from('profiles')
        .select('dialogflow_agent_id')
        .eq('user_id', user!.id)
        .single();

      if (!profile?.dialogflow_agent_id) {
        console.log('No agent to sync');
        return;
      }

      // Call google-update-agent to sync settings
      const updateResponse = await supabase.functions.invoke('google-update-agent', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (updateResponse.error) {
        console.error('Error syncing agent:', updateResponse.error);
      } else {
        console.log('Agent synced successfully:', updateResponse.data);
        
        // Also update intents
        await supabase.functions.invoke('google-update-intents', {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });
      }
    } catch (error) {
      console.error('Error syncing agent:', error);
      // Don't show error to user, this is a background operation
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('שם התסריט הוא שדה חובה');
      return;
    }

    if (!user) return;

    setSaving(true);

    try {
      const scriptData = {
        name: formData.name.trim(),
        greeting_message: formData.greeting_message.trim() || null,
        business_hours: formData.business_hours.trim() || null,
        services: formData.services.length > 0 ? formData.services : null,
        tone: formData.tone,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      let savedScriptId = existingScriptId;

      if (existingScriptId) {
        // Update existing script
        const { error } = await supabase
          .from('scripts')
          .update(scriptData)
          .eq('id', existingScriptId);

        if (error) throw error;
      } else {
        // Create new script
        const { data, error } = await supabase
          .from('scripts')
          .insert({
            ...scriptData,
            user_id: user.id,
          })
          .select('id')
          .single();

        if (error) throw error;
        savedScriptId = data?.id;
      }

      // Auto-sync agent with new script settings
      if (savedScriptId) {
        syncAgentWithScript(savedScriptId);
      }

      toast.success('התסריט נשמר בהצלחה');
      onComplete();
    } catch (error) {
      console.error('Error saving script:', error);
      toast.error('שגיאה בשמירת התסריט');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <FileText className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">הגדרת התסריט</CardTitle>
        <CardDescription>
          הגדר את המידע שהסוכן הקולי ישתמש בו בשיחות
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="name">שם התסריט</Label>
            <Input
              id="name"
              placeholder="תסריט ראשי"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="greeting">הודעת פתיחה</Label>
            <Textarea
              id="greeting"
              placeholder="שלום וברוכים הבאים ל... איך אפשר לעזור?"
              value={formData.greeting_message}
              onChange={(e) => setFormData(prev => ({ ...prev, greeting_message: e.target.value }))}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="hours">שעות פעילות</Label>
            <Input
              id="hours"
              placeholder="א'-ה' 09:00-18:00, ו' 09:00-13:00"
              value={formData.business_hours}
              onChange={(e) => setFormData(prev => ({ ...prev, business_hours: e.target.value }))}
            />
          </div>

          <div className="space-y-2">
            <Label>שירותים</Label>
            <div className="flex gap-2">
              <Input
                placeholder="הוסף שירות..."
                value={formData.newService}
                onChange={(e) => setFormData(prev => ({ ...prev, newService: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addService())}
              />
              <Button type="button" variant="outline" onClick={addService}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {formData.services.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {formData.services.map((service, index) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm"
                  >
                    {service}
                    <button
                      type="button"
                      onClick={() => removeService(index)}
                      className="hover:bg-primary/20 rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="tone">טון השיחה</Label>
            <Select
              value={formData.tone}
              onValueChange={(value) => setFormData(prev => ({ ...prev, tone: value }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {toneOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={onBack}
              className="flex-1"
            >
              <ArrowRight className="ml-2 h-4 w-4" />
              חזור
            </Button>
            <Button
              type="submit"
              className="flex-1 gradient-primary text-white"
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  שומר...
                </>
              ) : (
                <>
                  המשך
                  <ArrowLeft className="mr-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
