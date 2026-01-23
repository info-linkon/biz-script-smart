import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Phone, ArrowRight, Loader2, Check, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface AvailableNumber {
  phone_number_id: string;
  phone_number: string;
  country_code: string;
  monthly_cost: number;
}

interface PhoneStepProps {
  onComplete: () => void;
  onBack: () => void;
}

const countries = [
  { code: 'IL', name: 'ישראל', flag: '🇮🇱' },
  { code: 'US', name: 'ארה"ב', flag: '🇺🇸' },
  { code: 'GB', name: 'בריטניה', flag: '🇬🇧' },
];

export function PhoneStep({ onComplete, onBack }: PhoneStepProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [fetchingNumbers, setFetchingNumbers] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('IL');
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [purchaseComplete, setPurchaseComplete] = useState(false);

  useEffect(() => {
    // Get voice_id from active script
    const getVoiceId = async () => {
      if (!user) return;
      
      const { data } = await supabase
        .from('scripts')
        .select('voice_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (data?.voice_id) {
        setVoiceId(data.voice_id);
      }
    };

    getVoiceId();
  }, [user]);

  useEffect(() => {
    if (selectedCountry) {
      fetchAvailableNumbers();
    }
  }, [selectedCountry]);

  const fetchAvailableNumbers = async () => {
    setFetchingNumbers(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-get-available-numbers', {
        body: { country_code: selectedCountry },
      });

      if (error) throw error;

      if (data.success && data.numbers) {
        setAvailableNumbers(data.numbers);
        if (data.numbers.length > 0) {
          setSelectedNumber(data.numbers[0]);
        }
      } else {
        setAvailableNumbers([]);
      }
    } catch (error) {
      console.error('Error fetching numbers:', error);
      toast.error('שגיאה בטעינת מספרי טלפון זמינים');
    } finally {
      setFetchingNumbers(false);
    }
  };

  const handlePurchase = async () => {
    if (!selectedNumber || !voiceId) {
      toast.error('יש לבחור מספר טלפון');
      return;
    }

    setPurchasing(true);

    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-purchase-number', {
        body: {
          phone_number_id: selectedNumber.phone_number_id,
          voice_id: voiceId,
        },
      });

      if (error) throw error;

      if (data.success) {
        setPurchaseComplete(true);
        toast.success('המספר נרכש והסוכן הופעל בהצלחה!');
        
        // Wait a moment then complete
        setTimeout(() => {
          onComplete();
        }, 2000);
      } else {
        throw new Error(data.error || 'Failed to purchase number');
      }
    } catch (error) {
      console.error('Error purchasing number:', error);
      toast.error('שגיאה ברכישת המספר');
    } finally {
      setPurchasing(false);
    }
  };

  if (purchaseComplete) {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center animate-scale-in">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">הסוכן הקולי שלך מוכן!</h2>
          <p className="text-muted-foreground mb-4">
            המספר {selectedNumber?.phone_number} מחובר לסוכן שלך
          </p>
          <div className="flex items-center justify-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" />
            <span>מעביר אותך לדשבורד...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Phone className="h-8 w-8 text-primary" />
        </div>
        <CardTitle className="text-2xl">רכישת מספר טלפון</CardTitle>
        <CardDescription>
          בחר מספר טלפון ייעודי לסוכן הקולי שלך
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>בחר מדינה</Label>
          <Select value={selectedCountry} onValueChange={setSelectedCountry}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {countries.map((country) => (
                <SelectItem key={country.code} value={country.code}>
                  <span className="flex items-center gap-2">
                    <span>{country.flag}</span>
                    <span>{country.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {fetchingNumbers ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <span className="mr-2 text-muted-foreground">טוען מספרים זמינים...</span>
          </div>
        ) : availableNumbers.length > 0 ? (
          <div className="space-y-2">
            <Label>בחר מספר טלפון</Label>
            <div className="grid gap-2 max-h-64 overflow-y-auto">
              {availableNumbers.map((number) => (
                <div
                  key={number.phone_number_id}
                  className={`p-4 rounded-lg border cursor-pointer transition-all ${
                    selectedNumber?.phone_number_id === number.phone_number_id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  }`}
                  onClick={() => setSelectedNumber(number)}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-lg" dir="ltr">
                      {number.phone_number}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      ${number.monthly_cost}/חודש
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            אין מספרים זמינים במדינה זו כרגע
          </div>
        )}

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
            onClick={handlePurchase}
            className="flex-1 gradient-primary text-white"
            disabled={purchasing || !selectedNumber || !voiceId}
          >
            {purchasing ? (
              <>
                <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                רוכש ומפעיל...
              </>
            ) : (
              <>
                <Sparkles className="ml-2 h-4 w-4" />
                הפעל סוכן
              </>
            )}
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          עלות המספר תחויב מדי חודש. ניתן לבטל בכל עת.
        </p>
      </CardContent>
    </Card>
  );
}
