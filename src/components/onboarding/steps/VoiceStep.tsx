import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Volume2, ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { VoiceSelector } from '@/components/phone/VoiceSelector';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface VoiceStepProps {
  initialVoiceId?: string | null;
  onComplete: () => void;
  onBack: () => void;
}

export function VoiceStep({ initialVoiceId, onComplete, onBack }: VoiceStepProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(initialVoiceId || null);

  useEffect(() => {
    // Load existing voice from active script
    const loadVoice = async () => {
      if (!user) return;
      
      const { data } = await supabase
        .from('scripts')
        .select('voice_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (data?.voice_id) {
        setSelectedVoiceId(data.voice_id);
      }
    };

    if (!initialVoiceId) {
      loadVoice();
    }
  }, [user, initialVoiceId]);

  const handleSubmit = async () => {
    if (!selectedVoiceId) {
      toast.error('יש לבחור קול לסוכן');
      return;
    }

    if (!user) return;

    setSaving(true);

    try {
      // Update the active script with the selected voice
      const { error } = await supabase
        .from('scripts')
        .update({
          voice_id: selectedVoiceId,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;

      toast.success('הקול נבחר בהצלחה');
      onComplete();
    } catch (error) {
      console.error('Error saving voice:', error);
      toast.error('שגיאה בשמירת הקול');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Volume2 className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">בחירת קול</CardTitle>
        <CardDescription>
          בחר את הקול שבו הסוכן הקולי ידבר עם הלקוחות שלך
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <VoiceSelector
          selectedVoiceId={selectedVoiceId}
          onSelect={setSelectedVoiceId}
        />

        <div className="flex gap-3 pt-4">
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
            onClick={handleSubmit}
            className="flex-1 gradient-primary text-white"
            disabled={saving || !selectedVoiceId}
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
      </CardContent>
    </Card>
  );
}
