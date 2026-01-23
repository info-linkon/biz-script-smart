import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Phone, ArrowRight, Loader2, Check, Sparkles, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface PhoneStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function PhoneStep({ onComplete, onBack }: PhoneStepProps) {
  const { user } = useAuth();
  const [importing, setImporting] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [twilioAccountSid, setTwilioAccountSid] = useState('');
  const [twilioAuthToken, setTwilioAuthToken] = useState('');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [importComplete, setImportComplete] = useState(false);
  const [skipMode, setSkipMode] = useState(false);

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

  const handleImport = async () => {
    if (!phoneNumber || !twilioAccountSid || !twilioAuthToken) {
      toast.error('יש למלא את כל השדות');
      return;
    }

    if (!voiceId) {
      toast.error('יש להגדיר קול בשלב הקודם');
      return;
    }

    setImporting(true);

    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-import-number', {
        body: {
          phone_number: phoneNumber,
          twilio_account_sid: twilioAccountSid,
          twilio_auth_token: twilioAuthToken,
          voice_id: voiceId,
        },
      });

      if (error) throw error;

      if (data.success) {
        setImportComplete(true);
        toast.success('המספר יובא והסוכן הופעל בהצלחה!');
        
        // Wait a moment then complete
        setTimeout(() => {
          onComplete();
        }, 2000);
      } else {
        throw new Error(data.error || 'Failed to import number');
      }
    } catch (error) {
      console.error('Error importing number:', error);
      toast.error('שגיאה בייבוא המספר');
    } finally {
      setImporting(false);
    }
  };

  const handleSkip = async () => {
    // Create agent without phone number
    setImporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-create-agent', {
        body: {
          voice_id: voiceId,
        },
      });

      if (error) throw error;

      if (data.success) {
        toast.success('הסוכן נוצר בהצלחה! תוכל לחבר מספר טלפון בהמשך.');
        onComplete();
      } else {
        throw new Error(data.error || 'Failed to create agent');
      }
    } catch (error) {
      console.error('Error creating agent:', error);
      toast.error('שגיאה ביצירת הסוכן');
    } finally {
      setImporting(false);
    }
  };

  if (importComplete) {
    return (
      <Card className="border-0 shadow-lg">
        <CardContent className="py-12 text-center">
          <div className="mx-auto mb-6 h-20 w-20 rounded-full bg-primary/20 flex items-center justify-center animate-scale-in">
            <Check className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-2xl font-bold mb-2">הסוכן הקולי שלך מוכן!</h2>
          <p className="text-muted-foreground mb-4">
            המספר {phoneNumber} מחובר לסוכן שלך
          </p>
          <div className="flex items-center justify-center gap-2 text-primary">
            <Sparkles className="h-5 w-5" />
            <span>מעביר אותך לדשבורד...</span>
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
          <CardTitle className="text-2xl">חיבור מספר טלפון מ-Twilio</CardTitle>
          <CardDescription>
            חבר מספר טלפון קיים מחשבון Twilio שלך לסוכן הקולי
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-muted/50 rounded-lg p-4 text-sm">
            <p className="font-medium mb-2">איך להשיג את הפרטים?</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>היכנס לחשבון Twilio שלך</li>
              <li>רכוש מספר טלפון (Phone Numbers → Buy a Number)</li>
              <li>העתק את ה-Account SID וה-Auth Token מדף הקונסול</li>
            </ol>
            <a 
              href="https://console.twilio.com" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline mt-2"
            >
              <ExternalLink className="h-3 w-3" />
              פתח Twilio Console
            </a>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">מספר טלפון (בפורמט בינלאומי)</Label>
              <Input
                id="phoneNumber"
                placeholder="+972501234567"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilioSid">Twilio Account SID</Label>
              <Input
                id="twilioSid"
                placeholder="AC..."
                value={twilioAccountSid}
                onChange={(e) => setTwilioAccountSid(e.target.value)}
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="twilioToken">Twilio Auth Token</Label>
              <Input
                id="twilioToken"
                type="password"
                placeholder="Auth Token"
                value={twilioAuthToken}
                onChange={(e) => setTwilioAuthToken(e.target.value)}
                dir="ltr"
              />
            </div>
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
              onClick={handleImport}
              className="flex-1 gradient-primary text-white"
              disabled={importing || !phoneNumber || !twilioAccountSid || !twilioAuthToken}
            >
              {importing ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  מייבא ומפעיל...
                </>
              ) : (
                <>
                  <Sparkles className="ml-2 h-4 w-4" />
                  חבר והפעל סוכן
                </>
              )}
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
          חבר מספר טלפון לסוכן הקולי שלך
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Card className="border-2 border-primary/20 bg-primary/5 cursor-pointer hover:border-primary/40 transition-colors" onClick={() => setSkipMode(true)}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-primary/20 flex items-center justify-center">
                  <Phone className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">חבר מספר מ-Twilio</h3>
                  <p className="text-sm text-muted-foreground">
                    יש לך מספר Twilio? חבר אותו לסוכן שלך
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-border cursor-pointer hover:border-primary/40 transition-colors" onClick={handleSkip}>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-muted flex items-center justify-center">
                  <Sparkles className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold">המשך ללא מספר (לבינתיים)</h3>
                  <p className="text-sm text-muted-foreground">
                    צור את הסוכן וחבר מספר בהמשך
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
          לחיבור מספר תצטרך חשבון Twilio פעיל עם מספר טלפון.
        </p>
      </CardContent>
    </Card>
  );
}
