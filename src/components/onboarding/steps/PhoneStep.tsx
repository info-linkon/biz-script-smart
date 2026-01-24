import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Phone, ArrowRight, Loader2, Check, Sparkles, ShoppingCart } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Label } from '@/components/ui/label';

interface PhoneStepProps {
  onComplete: () => void;
  onBack: () => void;
}

const COUNTRIES = [
  { code: 'US', name: 'ארה"ב', prefix: '+1', price: '$1.15/חודש' },
  { code: 'GB', name: 'בריטניה', prefix: '+44', price: '$1.50/חודש' },
  { code: 'IL', name: 'ישראל', prefix: '+972', price: '$6.00/חודש' },
  { code: 'DE', name: 'גרמניה', prefix: '+49', price: '$1.50/חודש' },
  { code: 'FR', name: 'צרפת', prefix: '+33', price: '$1.50/חודש' },
];

const SETUP_STEPS = [
  { id: 'search', label: 'מחפש מספרים זמינים...' },
  { id: 'purchase', label: 'רוכש מספר...' },
  { id: 'agent', label: 'מגדיר סוכן קולי...' },
  { id: 'connect', label: 'מחבר מספר לסוכן...' },
];

export function PhoneStep({ onComplete, onBack }: PhoneStepProps) {
  const [purchasing, setPurchasing] = useState(false);
  const [countryCode, setCountryCode] = useState('US');
  const [currentStep, setCurrentStep] = useState(0);
  const [purchaseComplete, setPurchaseComplete] = useState(false);
  const [purchasedNumber, setPurchasedNumber] = useState('');
  const [skipMode, setSkipMode] = useState(false);
  const [skipping, setSkipping] = useState(false);

  const handlePurchase = async () => {
    setPurchasing(true);
    setCurrentStep(0);

    try {
      // Simulate step progress
      const stepInterval = setInterval(() => {
        setCurrentStep(prev => Math.min(prev + 1, SETUP_STEPS.length - 1));
      }, 1500);

      const { data, error } = await supabase.functions.invoke('google-purchase-number', {
        body: { 
          country_code: countryCode,
        },
      });

      clearInterval(stepInterval);

      if (error) throw error;

      if (data.success) {
        setPurchasedNumber(data.phone_number);
        setPurchaseComplete(true);
        toast.success('המספר נרכש והסוכן הופעל בהצלחה!');
        
        setTimeout(() => {
          onComplete();
        }, 2500);
      } else {
        throw new Error(data.error || 'Failed to complete setup');
      }
    } catch (error) {
      console.error('Error purchasing number:', error);
      toast.error('שגיאה ברכישת המספר. נסה שוב.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleSkip = async () => {
    setSkipping(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-create-agent', {
        body: {},
      });

      if (error) throw error;

      if (data.success) {
        toast.success('הסוכן נוצר בהצלחה! תוכל לרכוש מספר טלפון בהמשך.');
        onComplete();
      } else {
        throw new Error(data.error || 'Failed to create agent');
      }
    } catch (error) {
      console.error('Error creating agent:', error);
      toast.error('שגיאה ביצירת הסוכן');
    } finally {
      setSkipping(false);
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
          <p className="text-muted-foreground mb-2">
            המספר {purchasedNumber} מחובר לסוכן שלך
          </p>
          <p className="text-sm text-muted-foreground mb-4">
            ספק: Google Dialogflow CX
          </p>
          <div className="flex items-center justify-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" />
            <span>מעביר אותך לדשבורד...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (purchasing) {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="py-12">
          <div className="text-center mb-8">
            <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
            </div>
            <h2 className="text-xl font-bold mb-2">מגדיר את המספר שלך...</h2>
            <p className="text-sm text-muted-foreground">
              יוצר סוכן Google Dialogflow CX
            </p>
          </div>

          <div className="space-y-3 max-w-sm mx-auto">
            {SETUP_STEPS.map((step, index) => (
              <div 
                key={step.id}
                className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                  index === currentStep 
                    ? 'bg-primary/10 border border-primary/20' 
                    : index < currentStep 
                      ? 'bg-muted/50' 
                      : 'opacity-50'
                }`}
              >
                <div className={`h-6 w-6 rounded-full flex items-center justify-center text-sm ${
                  index < currentStep 
                    ? 'bg-primary text-primary-foreground' 
                    : index === currentStep 
                      ? 'bg-primary/20 text-primary' 
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {index < currentStep ? (
                    <Check className="h-3 w-3" />
                  ) : index === currentStep ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={`text-sm ${
                  index <= currentStep ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (skipMode) {
    return (
      <Card className="border-0 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Phone className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">רכישת מספר טלפון</CardTitle>
          <CardDescription>
            בחר מדינה למספר הטלפון שלך
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Google Dialogflow Info */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-teal-500/10 border border-green-500/20">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-xl flex-shrink-0">
                🎯
              </div>
              <div>
                <h4 className="font-semibold text-green-700 dark:text-green-400">Google Dialogflow CX</h4>
                <p className="text-sm text-muted-foreground">
                  זיהוי עברית מצוין עם Chirp 3 • עלות נמוכה • אמינות גבוהה
                </p>
              </div>
            </div>
          </div>

          {/* Country Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">בחר מדינה</Label>
            <Select value={countryCode} onValueChange={setCountryCode}>
              <SelectTrigger>
                <SelectValue placeholder="בחר מדינה" />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    <div className="flex items-center justify-between gap-4 w-full">
                      <span>{country.name} ({country.prefix})</span>
                      <span className="text-muted-foreground text-xs">{country.price}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p className="text-muted-foreground">
              המספר יהיה פעיל מיד לאחר הרכישה וישויך לסוכן Google Dialogflow CX שלך.
              תוכל לקבל שיחות נכנסות ללא הגדרות נוספות.
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setSkipMode(false)}
              className="flex-1"
            >
              <ArrowRight className="ml-2 h-4 w-4" />
              חזור
            </Button>
            <Button
              onClick={handlePurchase}
              className="flex-1 gradient-primary text-white"
              disabled={purchasing}
            >
              <ShoppingCart className="ml-2 h-4 w-4" />
              רכוש מספר
            </Button>
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
        <CardTitle className="text-2xl">חיבור מספר טלפון</CardTitle>
        <CardDescription>
          רכוש מספר טלפון ייעודי לסוכן הקולי שלך
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Card 
            className="border-2 border-primary/20 bg-primary/5 cursor-pointer hover:border-primary/40 transition-colors" 
            onClick={() => setSkipMode(true)}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                  <ShoppingCart className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">רכוש מספר טלפון</h3>
                  <p className="text-sm text-muted-foreground">
                    קבל מספר ייעודי שיחובר אוטומטית לסוכן שלך
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card 
            className="border border-border cursor-pointer hover:border-primary/40 transition-colors" 
            onClick={handleSkip}
          >
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                  {skipping ? (
                    <Loader2 className="h-6 w-6 text-muted-foreground animate-spin" />
                  ) : (
                    <Sparkles className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">המשך ללא מספר (לבינתיים)</h3>
                  <p className="text-sm text-muted-foreground">
                    צור את הסוכן ורכוש מספר בהמשך
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

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
        </div>

        <p className="text-xs text-center text-muted-foreground">
          המספרים מסופקים דרך Twilio. העלות נגבית חודשית.
        </p>
      </CardContent>
    </Card>
  );
}
