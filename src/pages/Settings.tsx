import { useState, useEffect } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { User, Building2, Phone, MapPin, Loader2, Save, Volume2, Play, Pause, Languages, Zap, Globe, RefreshCw } from 'lucide-react';
import { PhoneNumberManager } from '@/components/phone/PhoneNumberManager';
import { VoiceSelector } from '@/components/phone/VoiceSelector';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { type VoiceProvider, getProviderInfo, setVoiceProvider } from '@/lib/voice-provider';

interface Profile {
  business_name: string | null;
  business_type: string | null;
  phone: string | null;
  address: string | null;
  elevenlabs_agent_id: string | null;
  vapi_assistant_id: string | null;
  voice_provider: VoiceProvider | null;
}

export default function Settings() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<Profile>({
    business_name: '',
    business_type: '',
    phone: '',
    address: '',
    elevenlabs_agent_id: null,
    vapi_assistant_id: null,
    voice_provider: 'elevenlabs',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('he');
  const [currentVoiceName, setCurrentVoiceName] = useState<string | null>(null);
  const [currentVoicePreviewUrl, setCurrentVoicePreviewUrl] = useState<string | null>(null);
  const [savingVoice, setSavingVoice] = useState(false);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
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
          elevenlabs_agent_id: data.elevenlabs_agent_id || null,
          vapi_assistant_id: data.vapi_assistant_id || null,
          voice_provider: (data.voice_provider as VoiceProvider) || 'elevenlabs',
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
          
          // Fetch voice name and preview URL from ElevenLabs
          const { data } = await supabase.functions.invoke('elevenlabs-get-voices');
          if (data?.success && data.voices) {
            const voice = data.voices.find((v: any) => v.voice_id === script.voice_id);
            if (voice) {
              setCurrentVoiceName(voice.name);
              setCurrentVoicePreviewUrl(voice.preview_url || null);
            }
          }
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
    if (!profile.elevenlabs_agent_id && !profile.vapi_assistant_id) {
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

      // Update the agent based on the current provider
      const updateFunction = profile.voice_provider === 'vapi' 
        ? 'vapi-update-assistant' 
        : 'elevenlabs-update-agent';

      const { data, error } = await supabase.functions.invoke(updateFunction, {
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
    
    if (!profile.elevenlabs_agent_id && !profile.vapi_assistant_id) {
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

      // Call update agent based on current provider
      const updateFunction = profile.voice_provider === 'vapi' 
        ? 'vapi-update-assistant' 
        : 'elevenlabs-update-agent';

      const { data, error } = await supabase.functions.invoke(updateFunction, {
        body: { 
          script_id: scriptId,
          voice_id: voiceId 
        }
      });

      if (error) throw error;

      if (data?.success) {
        // Update the displayed voice name
        if (voiceName) {
          setCurrentVoiceName(voiceName);
        } else {
          // Fetch voice name if not provided
          const { data: voicesData } = await supabase.functions.invoke('elevenlabs-get-voices');
          if (voicesData?.success && voicesData.voices) {
            const voice = voicesData.voices.find((v: any) => v.voice_id === voiceId);
            if (voice) {
              setCurrentVoiceName(voice.name);
              setCurrentVoicePreviewUrl(voice.preview_url || null);
            }
          }
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
    if (!profile.vapi_assistant_id && !profile.elevenlabs_agent_id) {
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

      // Determine which function to call based on provider
      const updateFunction = profile.voice_provider === 'vapi' 
        ? 'vapi-update-assistant' 
        : 'elevenlabs-update-agent';

      const { data, error } = await supabase.functions.invoke(updateFunction, {
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

        {/* Voice Provider Selection */}
        {(profile.elevenlabs_agent_id || profile.vapi_assistant_id) && (
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                ספק Voice AI
              </CardTitle>
              <CardDescription>
                בחר את הספק שישמש לשיחות הסוכן שלך
              </CardDescription>
            </CardHeader>
            <CardContent>
              {savingProvider && (
                <div className="flex items-center gap-2 mb-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  מעדכן את הספק...
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* ElevenLabs Option */}
                <div
                  className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    profile.voice_provider === 'elevenlabs'
                      ? 'border-primary bg-primary/5 shadow-md'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  } ${savingProvider ? 'opacity-50 pointer-events-none' : ''}`}
                  onClick={async () => {
                    if (savingProvider || profile.voice_provider === 'elevenlabs') return;
                    setSavingProvider(true);
                    const success = await setVoiceProvider(user!.id, 'elevenlabs');
                    if (success) {
                      setProfile({ ...profile, voice_provider: 'elevenlabs' });
                      toast.success('הספק עודכן ל-ElevenLabs');
                    } else {
                      toast.error('שגיאה בעדכון הספק');
                    }
                    setSavingProvider(false);
                  }}
                >
                  {profile.voice_provider === 'elevenlabs' && (
                    <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-primary" />
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-yellow-400 to-orange-500 flex items-center justify-center text-white text-xl">
                      ⚡
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">ElevenLabs</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        מהיר ואיכותי • מתאים לאנגלית
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">מהיר</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">עלות נמוכה</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Vapi Option */}
                <div
                  className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    profile.voice_provider === 'vapi'
                      ? 'border-primary bg-primary/5 shadow-md'
                      : 'border-border hover:border-primary/50 hover:bg-muted/30'
                  } ${savingProvider ? 'opacity-50 pointer-events-none' : ''}`}
                  onClick={async () => {
                    if (savingProvider || profile.voice_provider === 'vapi') return;
                    setSavingProvider(true);
                    const success = await setVoiceProvider(user!.id, 'vapi');
                    if (success) {
                      setProfile({ ...profile, voice_provider: 'vapi' });
                      toast.success('הספק עודכן ל-Vapi.ai');
                    } else {
                      toast.error('שגיאה בעדכון הספק');
                    }
                    setSavingProvider(false);
                  }}
                >
                  {profile.voice_provider === 'vapi' && (
                    <div className="absolute top-2 left-2 w-3 h-3 rounded-full bg-primary" />
                  )}
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xl">
                      🌍
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">Vapi.ai</h4>
                      <p className="text-sm text-muted-foreground mt-1">
                        תמיכה מלאה בעברית וערבית
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">עברית מלאה</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">ערבית</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                💡 <strong>טיפ:</strong> Vapi.ai מומלץ אם רוב הלקוחות שלך מדברים עברית או ערבית
              </p>
            </CardContent>
          </Card>
        )}

        {/* Language & Voice Settings */}
        {(profile.elevenlabs_agent_id || profile.vapi_assistant_id) && (
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
