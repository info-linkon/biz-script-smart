import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Volume2, ArrowLeft, ArrowRight, Loader2, Languages } from 'lucide-react';
import { VoiceSelector } from '@/components/phone/VoiceSelector';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface VoiceStepProps {
  initialVoiceId?: string | null;
  onComplete: () => void;
  onBack: () => void;
}

const LANGUAGES = [
  { code: 'he', name: 'עברית', flag: '🇮🇱' },
  { code: 'ar', name: 'ערבית', flag: '🇸🇦' },
  { code: 'en', name: 'אנגלית', flag: '🇺🇸' },
];

export function VoiceStep({ initialVoiceId, onComplete, onBack }: VoiceStepProps) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(initialVoiceId || null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('he');

  useEffect(() => {
    // Load existing voice and language from active script
    const loadScript = async () => {
      if (!user) return;
      
      const { data } = await supabase
        .from('scripts')
        .select('voice_id, language')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (data?.voice_id) {
        setSelectedVoiceId(data.voice_id);
      }
      if (data?.language) {
        setSelectedLanguage(data.language);
      }
    };

    if (!initialVoiceId) {
      loadScript();
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
      // Update the active script with the selected voice and language
      const { error } = await supabase
        .from('scripts')
        .update({
          voice_id: selectedVoiceId,
          language: selectedLanguage,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', user.id)
        .eq('is_active', true);

      if (error) throw error;

      toast.success('הקול והשפה נבחרו בהצלחה');
      onComplete();
    } catch (error) {
      console.error('Error saving voice:', error);
      toast.error('שגיאה בשמירת הקול');
    } finally {
      setSaving(false);
    }
  };

  // Reset voice selection when language changes
  const handleLanguageChange = (language: string) => {
    setSelectedLanguage(language);
    setSelectedVoiceId(null); // Reset voice when language changes
  };

  return (
    <div className="space-y-6">
      {/* Language Selection Card */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Languages className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">שפת הסוכן</CardTitle>
          <CardDescription>
            באיזו שפה הסוכן ידבר עם הלקוחות שלך?
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup 
            value={selectedLanguage} 
            onValueChange={handleLanguageChange}
            className="grid grid-cols-3 gap-4"
          >
            {LANGUAGES.map((lang) => (
              <div key={lang.code}>
                <RadioGroupItem
                  value={lang.code}
                  id={`lang-${lang.code}`}
                  className="peer sr-only"
                />
                <Label
                  htmlFor={`lang-${lang.code}`}
                  className="flex flex-col items-center justify-center rounded-xl border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/10 cursor-pointer transition-all"
                >
                  <span className="text-3xl mb-2">{lang.flag}</span>
                  <span className="font-medium">{lang.name}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </CardContent>
      </Card>

      {/* Voice Selection Card */}
      <Card className="border-0 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Volume2 className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">בחירת קול</CardTitle>
          <CardDescription>
            בחר את הקול שבו הסוכן ידבר - מותאם לשפה שבחרת
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <VoiceSelector
            selectedVoiceId={selectedVoiceId}
            onSelect={setSelectedVoiceId}
            language={selectedLanguage}
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
    </div>
  );
}
