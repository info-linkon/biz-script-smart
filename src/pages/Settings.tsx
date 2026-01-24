import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { User, Building2, Phone, MapPin, Loader2, Save, Volume2, Play, Pause, Languages, RefreshCw } from 'lucide-react';
import { PhoneNumberManager } from '@/components/phone/PhoneNumberManager';
import { VoiceSelector } from '@/components/phone/VoiceSelector';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

interface Profile {
  business_name: string | null;
  business_type: string | null;
  phone: string | null;
  address: string | null;
  dialogflow_agent_id: string | null;
}

export default function Settings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile>({
    business_name: '',
    business_type: '',
    phone: '',
    address: '',
    dialogflow_agent_id: null,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('he');
  const [currentVoiceName, setCurrentVoiceName] = useState<string | null>(null);
  const [currentVoicePreviewUrl, setCurrentVoicePreviewUrl] = useState<string | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [playingPreview, setPlayingPreview] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [syncingAgent, setSyncingAgent] = useState(false);

  const LANGUAGES = [
    { code: 'he', name: 'עברית', flag: '🇮🇱' },
    { code: 'ar', name: 'ערבית', flag: '🇸🇦' },
    { code: 'en', name: 'English', flag: '🇺🇸' },
  ];

  useEffect(() => {
    if (user) {
      fetchProfile();
      fetchCurrentVoice();
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
          dialogflow_agent_id: (data as any).dialogflow_agent_id || null,
        });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCurrentVoice = async () => {
    try {
      // Get user's active script with voice_id and language
      const { data: script } = await supabase
        .from('scripts')
        .select('voice_id, language')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .single();

      if (script) {
        // Set language
        if (script.language) {
          setSelectedLanguage(script.language);
        }
        
        // Set voice
        if (script.voice_id) {
          setSelectedVoiceId(script.voice_id);
          setCurrentVoiceName(script.voice_id);
        }
      }
    } catch (error) {
      console.error('Error fetching current voice:', error);
    }
  };

  const playCurrentVoicePreview = async () => {
    if (!currentVoicePreviewUrl) {
      toast.error('אין תצוגה מקדימה זמינה לקול זה');
      return;
    }

    if (playingPreview) {
      // Stop current playback
      if (audioElement) {
        audioElement.pause();
        setAudioElement(null);
      }
      setPlayingPreview(false);
      return;
    }

    try {
      const audio = new Audio(currentVoicePreviewUrl);
      audio.onended = () => {
        setPlayingPreview(false);
        setAudioElement(null);
      };
      audio.onerror = () => {
        toast.error('שגיאה בהפעלת התצוגה המקדימה');
        setPlayingPreview(false);
        setAudioElement(null);
      };
      
      setAudioElement(audio);
      setPlayingPreview(true);
      await audio.play();
    } catch (error) {
      console.error('Error playing preview:', error);
      toast.error('שגיאה בהפעלת התצוגה המקדימה');
      setPlayingPreview(false);
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

  const handleLanguageChange = async (langCode: string) => {
    if (!profile.dialogflow_agent_id) {
      toast.error('יש לרכוש מספר טלפון קודם כדי לשנות שפה');
      return;
    }

    setSavingLanguage(true);
    const previousLanguage = selectedLanguage;
    setSelectedLanguage(langCode);

    try {
      // Get user's active script
      const { data: scripts } = await supabase
        .from('scripts')
        .select('id')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .limit(1);

      const scriptId = scripts?.[0]?.id;

      if (!scriptId) {
        toast.error('יש ליצור תסריט פעיל קודם');
        setSelectedLanguage(previousLanguage);
        setSavingLanguage(false);
        return;
      }

      // Update language in the script
      await supabase
        .from('scripts')
        .update({ language: langCode })
        .eq('id', scriptId);

      // Update the Google agent
      const { data, error } = await supabase.functions.invoke('google-update-agent', {
        body: { 
          script_id: scriptId,
          language: langCode 
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('שפת הסוכן עודכנה בהצלחה');
        // Reset voice selection when language changes (voice might not support new language)
        setSelectedVoiceId(null);
        setCurrentVoiceName(null);
        setCurrentVoicePreviewUrl(null);
      } else {
        throw new Error(data?.error || 'Failed to update language');
      }
    } catch (error) {
      console.error('Error updating language:', error);
      setSelectedLanguage(previousLanguage);
      toast.error('שגיאה בעדכון השפה');
    } finally {
      setSavingLanguage(false);
    }
  };

  const handleVoiceChange = async (voiceId: string, voiceName?: string) => {
    setSelectedVoiceId(voiceId);
    
    if (!profile.dialogflow_agent_id) {
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

      // Update voice_id in the script
      await supabase
        .from('scripts')
        .update({ voice_id: voiceId })
        .eq('id', scriptId);

      // Call update agent for Google
      const { data, error } = await supabase.functions.invoke('google-update-agent', {
        body: { 
          script_id: scriptId,
          voice_id: voiceId 
        }
      });

      if (error) throw error;

      if (data?.success) {
        if (voiceName) {
          setCurrentVoiceName(voiceName);
        }
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

  const handleSyncAgent = async () => {
    if (!profile.dialogflow_agent_id) {
      toast.error('אין סוכן לסנכרון. יש להשלים את תהליך ה-Onboarding קודם.');
      return;
    }

    setSyncingAgent(true);

    try {
      // Get user's active script
      const { data: scripts, error: scriptError } = await supabase
        .from('scripts')
        .select('id, voice_id, language')
        .eq('user_id', user!.id)
        .eq('is_active', true)
        .limit(1);

      if (scriptError) throw scriptError;

      const script = scripts?.[0];

      if (!script) {
        toast.error('לא נמצא תסריט פעיל. יש ליצור תסריט קודם.');
        setSyncingAgent(false);
        return;
      }

      const { data, error } = await supabase.functions.invoke('google-update-agent', {
        body: { 
          script_id: script.id,
          voice_id: script.voice_id,
          language: script.language
        }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('הגדרות הסוכן סונכרנו בהצלחה! 🎉');
      } else {
        throw new Error(data?.error || 'Failed to sync agent');
      }
    } catch (error) {
      console.error('Error syncing agent:', error);
      toast.error('שגיאה בסנכרון הסוכן');
    } finally {
      setSyncingAgent(false);
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

        {/* Voice Provider Status */}
        {profile.dialogflow_agent_id && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span className="text-xl">🎯</span>
                ספק Voice AI
              </CardTitle>
              <CardDescription>
                הסוכן שלך משתמש ב-Google Dialogflow CX
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="p-4 rounded-xl bg-gradient-to-br from-green-500/10 to-teal-500/10 border border-green-500/20">
                <div className="flex items-start gap-3">
                  <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center text-2xl flex-shrink-0">
                    🎯
                  </div>
                  <div>
                    <h4 className="font-semibold text-green-700 dark:text-green-400">Google Dialogflow CX</h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      זיהוי עברית מצוין עם Chirp 3 • עלות נמוכה • אמינות גבוהה • תמיכה בערבית
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Language & Voice Settings */}
        {profile.dialogflow_agent_id && (
          <>
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Languages className="h-5 w-5 text-primary" />
                  שפת הסוכן
                </CardTitle>
                <CardDescription>
                  בחר את השפה הראשית שבה הסוכן ידבר • הסוכן יזהה אוטומטית מעבר בין שפות
                </CardDescription>
              </CardHeader>
              <CardContent>
                {savingLanguage && (
                  <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    מעדכן את השפה...
                  </div>
                )}
                <RadioGroup 
                  value={selectedLanguage} 
                  onValueChange={handleLanguageChange}
                  className="grid grid-cols-3 gap-3"
                  disabled={savingLanguage}
                >
                  {LANGUAGES.map((lang) => (
                    <div
                      key={lang.code}
                      className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedLanguage === lang.code
                          ? 'border-primary bg-primary/10 shadow-md'
                          : 'border-border hover:border-primary/50 hover:bg-muted/30'
                      }`}
                      onClick={() => !savingLanguage && handleLanguageChange(lang.code)}
                    >
                      <RadioGroupItem value={lang.code} id={`lang-${lang.code}`} />
                      <Label 
                        htmlFor={`lang-${lang.code}`} 
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <span className="text-xl">{lang.flag}</span>
                        <span className="font-medium">{lang.name}</span>
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
                <p className="mt-3 text-sm text-muted-foreground">
                  💡 הסוכן תומך במעבר אוטומטי בין עברית, ערבית ואנגלית בזמן השיחה
                </p>
              </CardContent>
            </Card>

            {/* Voice Settings */}
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
                {/* Current Voice Display */}
                {currentVoiceName && (
                  <div className={`mb-4 p-3 rounded-lg border transition-all ${
                    playingPreview 
                      ? 'bg-primary/10 border-primary/40 shadow-md' 
                      : 'bg-primary/5 border-primary/20'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {playingPreview ? (
                          <div className="flex items-center gap-0.5 h-4">
                            <div className="w-1 h-3 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '0ms' }} />
                            <div className="w-1 h-4 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '150ms' }} />
                            <div className="w-1 h-2 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '300ms' }} />
                            <div className="w-1 h-3 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '450ms' }} />
                          </div>
                        ) : (
                          <Volume2 className="h-4 w-4 text-primary" />
                        )}
                        <span className="text-sm text-muted-foreground">קול נוכחי:</span>
                        <span className={`font-medium text-primary ${playingPreview ? 'animate-audio-pulse' : ''}`}>
                          {currentVoiceName}
                        </span>
                      </div>
                      {currentVoicePreviewUrl && (
                        <Button
                          variant={playingPreview ? "default" : "outline"}
                          size="sm"
                          onClick={playCurrentVoicePreview}
                          className={`h-8 transition-all ${playingPreview ? 'gradient-primary text-white' : ''}`}
                        >
                          {playingPreview ? (
                            <>
                              <Pause className="ml-1 h-4 w-4" />
                              עצור
                            </>
                          ) : (
                            <>
                              <Play className="ml-1 h-4 w-4" />
                              האזן
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                )}
                
                {savingVoice && (
                  <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    מעדכן את הקול...
                  </div>
                )}
                <VoiceSelector 
                  selectedVoiceId={selectedVoiceId} 
                  onSelect={(voiceId) => {
                    handleVoiceChange(voiceId);
                  }}
                  currentVoiceName={currentVoiceName}
                  language={selectedLanguage}
                />
              </CardContent>
            </Card>

            {/* Sync Agent Settings */}
            <Card className="border-0 shadow-sm border-l-4 border-l-primary">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-primary" />
                  סנכרון הגדרות סוכן
                </CardTitle>
                <CardDescription>
                  עדכן את הסוכן עם כל ההגדרות האחרונות (שפה, קול, מודל TTS)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    אם הסוכן לא מדבר כראוי או אם ביצעת שינויים בהגדרות, לחץ על הכפתור למטה כדי לסנכרן את כל ההגדרות.
                  </p>
                  <Button 
                    onClick={handleSyncAgent}
                    disabled={syncingAgent}
                    className="w-full gradient-primary text-white"
                  >
                    {syncingAgent ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        מסנכרן הגדרות...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="ml-2 h-4 w-4" />
                        סנכרן הגדרות סוכן
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    💡 <strong>טיפ:</strong> לחץ כאן אם הסוכן מדבר "עברית מקולקלת" או אם השפה לא נשמעת נכון
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
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
