import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Phone, Plus, Loader2, CheckCircle, AlertCircle, Copy, PhoneForwarded } from 'lucide-react';
import { VoiceSelector } from './VoiceSelector';

interface PhoneNumber {
  id: string;
  elevenlabs_phone_id: string;
  elevenlabs_agent_id?: string;
  phone_number: string;
  country_code: string;
  status: string;
  monthly_cost: number | null;
  is_active: boolean;
  purchased_at: string;
}

interface AvailableNumber {
  phone_number_id: string;
  phone_number: string;
  country_code: string;
  monthly_cost?: number;
}

export function PhoneNumberManager() {
  const { user } = useAuth();
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState('IL');
  const [selectedNumber, setSelectedNumber] = useState<AvailableNumber | null>(null);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<'number' | 'voice'>('number');

  useEffect(() => {
    if (user) {
      fetchPhoneNumbers();
    }
  }, [user]);

  const fetchPhoneNumbers = async () => {
    try {
      const { data, error } = await supabase
        .from('phone_numbers')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setPhoneNumbers(data || []);
    } catch (error) {
      console.error('Error fetching phone numbers:', error);
      toast.error('שגיאה בטעינת מספרי הטלפון');
    } finally {
      setLoading(false);
    }
  };

  const fetchAvailableNumbers = async () => {
    setLoadingAvailable(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-get-available-numbers', {
        body: { country_code: selectedCountry }
      });

      if (error) throw error;
      
      if (data.success) {
        setAvailableNumbers(data.numbers || []);
      } else {
        throw new Error(data.error || 'Failed to fetch available numbers');
      }
    } catch (error) {
      console.error('Error fetching available numbers:', error);
      toast.error('שגיאה בטעינת מספרים זמינים');
      setAvailableNumbers([]);
    } finally {
      setLoadingAvailable(false);
    }
  };

  const purchaseNumber = async () => {
    if (!selectedNumber) return;
    
    setPurchasing(true);
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-purchase-number', {
        body: {
          phone_number_id: selectedNumber.phone_number_id,
          voice_id: selectedVoiceId || undefined,
        }
      });

      if (error) throw error;
      
      if (data.success) {
        toast.success('המספר נרכש והסוכן נוצר בהצלחה!');
        setDialogOpen(false);
        setSelectedNumber(null);
        setSelectedVoiceId(null);
        setCurrentStep('number');
        fetchPhoneNumbers();
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

  const handleNextStep = () => {
    if (currentStep === 'number' && selectedNumber) {
      setCurrentStep('voice');
    }
  };

  const handleBackStep = () => {
    if (currentStep === 'voice') {
      setCurrentStep('number');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('המספר הועתק ללוח');
  };

  const openPurchaseDialog = () => {
    setDialogOpen(true);
    setCurrentStep('number');
    setSelectedNumber(null);
    setSelectedVoiceId(null);
    fetchAvailableNumbers();
  };

  const handleCountryChange = (country: string) => {
    setSelectedCountry(country);
    setSelectedNumber(null);
    // Fetch new numbers when country changes
    setTimeout(() => {
      fetchAvailableNumbers();
    }, 100);
  };

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5 text-primary" />
          מספר טלפון לסוכן
        </CardTitle>
        <CardDescription>
          רכוש מספר טלפון ייעודי שאליו יופנו השיחות
        </CardDescription>
      </CardHeader>
      <CardContent>
        {phoneNumbers.length === 0 ? (
          <div className="text-center py-6">
            <Phone className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-2">אין מספר טלפון עדיין</h3>
            <p className="text-muted-foreground text-sm mb-4">
              רכוש מספר טלפון כדי שהסוכן יוכל לקבל שיחות
            </p>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-white" onClick={openPurchaseDialog}>
                  <Plus className="ml-2 h-4 w-4" />
                  רכוש מספר טלפון
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                  <DialogTitle>
                    {currentStep === 'number' ? 'רכישת מספר טלפון' : 'בחירת קול לסוכן'}
                  </DialogTitle>
                  <DialogDescription>
                    {currentStep === 'number' 
                      ? 'בחר מספר טלפון שיוקצה לעסק שלך' 
                      : 'בחר את הקול שבו הסוכן ידבר עם הלקוחות'}
                  </DialogDescription>
                </DialogHeader>
                
                {currentStep === 'number' ? (
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">בחר מדינה</label>
                      <Select value={selectedCountry} onValueChange={handleCountryChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="IL">🇮🇱 ישראל</SelectItem>
                          <SelectItem value="US">🇺🇸 ארה"ב</SelectItem>
                          <SelectItem value="GB">🇬🇧 בריטניה</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {loadingAvailable ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      </div>
                    ) : availableNumbers.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground">
                        <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>אין מספרים זמינים במדינה זו כרגע</p>
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {availableNumbers.map((number) => (
                          <button
                            key={number.phone_number_id}
                            onClick={() => setSelectedNumber(number)}
                            className={`w-full p-3 rounded-lg border text-right transition-colors ${
                              selectedNumber?.phone_number_id === number.phone_number_id
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-lg" dir="ltr">{number.phone_number}</span>
                              {selectedNumber?.phone_number_id === number.phone_number_id && (
                                <CheckCircle className="h-5 w-5 text-primary" />
                              )}
                            </div>
                            {number.monthly_cost && (
                              <p className="text-sm text-muted-foreground mt-1">
                                ${number.monthly_cost}/חודש
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-4">
                    <VoiceSelector 
                      selectedVoiceId={selectedVoiceId} 
                      onSelect={setSelectedVoiceId}
                      compact
                    />
                  </div>
                )}

                <DialogFooter>
                  {currentStep === 'voice' && (
                    <Button variant="outline" onClick={handleBackStep}>
                      חזור
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    ביטול
                  </Button>
                  {currentStep === 'number' ? (
                    <Button 
                      onClick={handleNextStep} 
                      disabled={!selectedNumber}
                      className="gradient-primary text-white"
                    >
                      הבא
                    </Button>
                  ) : (
                    <Button 
                      onClick={purchaseNumber} 
                      disabled={purchasing}
                      className="gradient-primary text-white"
                    >
                      {purchasing ? (
                        <>
                          <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                          יוצר סוכן...
                        </>
                      ) : (
                        'רכוש והפעל'
                      )}
                    </Button>
                  )}
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        ) : (
          <div className="space-y-4">
            {phoneNumbers.map((phone) => (
              <div key={phone.id} className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                      <Phone className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-mono text-lg font-medium" dir="ltr">{phone.phone_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {phone.country_code === 'IL' ? 'ישראל' : phone.country_code === 'US' ? 'ארה"ב' : phone.country_code}
                      </p>
                    </div>
                  </div>
                  <Badge variant={phone.is_active ? 'default' : 'secondary'}>
                    {phone.status === 'active' ? 'פעיל' : phone.status === 'pending' ? 'בהמתנה' : 'מושבת'}
                  </Badge>
                </div>
                
                <div className="flex items-center gap-2 mt-3">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => copyToClipboard(phone.phone_number)}
                  >
                    <Copy className="ml-1 h-4 w-4" />
                    העתק מספר
                  </Button>
                </div>

                {phone.is_active && (
                  <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                    <div className="flex items-start gap-2">
                      <PhoneForwarded className="h-5 w-5 text-primary mt-0.5" />
                      <div>
                        <p className="font-medium text-sm">הוראות הפניית שיחות</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          הגדר הפניית שיחות מהטלפון העסקי שלך למספר זה כאשר אין מענה.
                          כך הסוכן יענה ללקוחות כשאתה לא זמין.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
