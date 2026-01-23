import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Volume2, Play, Pause } from 'lucide-react';
import { toast } from 'sonner';

interface Voice {
  voice_id: string;
  name: string;
  preview_url?: string;
  category?: string;
  labels?: Record<string, string>;
  description?: string;
}

interface VoiceSelectorProps {
  selectedVoiceId: string | null;
  onSelect: (voiceId: string) => void;
  compact?: boolean;
  currentVoiceName?: string | null;
}

export function VoiceSelector({ selectedVoiceId, onSelect, compact = false, currentVoiceName }: VoiceSelectorProps) {
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchVoices();
    return () => {
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, []);

  const fetchVoices = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-get-voices');

      if (error) throw error;
      
      if (data.success) {
        // Filter to show fewer voices in compact mode
        const allVoices = data.voices || [];
        setVoices(compact ? allVoices.slice(0, 6) : allVoices);
      } else {
        throw new Error(data.error || 'Failed to fetch voices');
      }
    } catch (error) {
      console.error('Error fetching voices:', error);
      // Use some default voices as fallback
      setVoices([
        { voice_id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel (Default)' },
        { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah' },
        { voice_id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Adam' },
        { voice_id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const playPreview = async (voice: Voice) => {
    if (!voice.preview_url) {
      toast.error('אין תצוגה מקדימה זמינה לקול זה');
      return;
    }

    if (playingId === voice.voice_id) {
      // Stop current playback
      if (audioElement) {
        audioElement.pause();
        setAudioElement(null);
      }
      setPlayingId(null);
      return;
    }

    // Stop any existing playback
    if (audioElement) {
      audioElement.pause();
    }

    try {
      const audio = new Audio(voice.preview_url);
      audio.onended = () => {
        setPlayingId(null);
        setAudioElement(null);
      };
      audio.onerror = () => {
        toast.error('שגיאה בהפעלת התצוגה המקדימה');
        setPlayingId(null);
        setAudioElement(null);
      };
      
      setAudioElement(audio);
      setPlayingId(voice.voice_id);
      await audio.play();
    } catch (error) {
      console.error('Error playing preview:', error);
      toast.error('שגיאה בהפעלת התצוגה המקדימה');
      setPlayingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (compact) {
    return (
      <div className="space-y-3">
        <Label className="text-sm font-medium">בחר קול לסוכן</Label>
        <RadioGroup 
          value={selectedVoiceId || ''} 
          onValueChange={onSelect}
          className="grid grid-cols-2 gap-2"
        >
          {voices.map((voice, index) => (
            <div 
              key={voice.voice_id} 
              className={`flex items-center space-x-2 space-x-reverse animate-fade-in p-2 rounded-lg transition-all duration-200 cursor-pointer ${
                playingId === voice.voice_id 
                  ? 'bg-primary/10 shadow-md scale-[1.02]' 
                  : 'hover:bg-muted/50 hover:shadow-sm hover:scale-[1.01]'
              }`}
              style={{ animationDelay: `${index * 50}ms`, animationFillMode: 'backwards' }}
            >
              <Label 
                htmlFor={voice.voice_id} 
                className="flex-1 cursor-pointer text-sm"
              >
                {voice.name}
              </Label>
              {voice.preview_url && (
                <Button
                  type="button"
                  variant={playingId === voice.voice_id ? "default" : "ghost"}
                  size="icon"
                  className={`h-6 w-6 transition-all ${playingId === voice.voice_id ? 'bg-primary' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    playPreview(voice);
                  }}
                >
                  {playingId === voice.voice_id ? (
                    <div className="flex items-center gap-0.5">
                      <div className="w-0.5 h-2 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '0ms' }} />
                      <div className="w-0.5 h-3 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '150ms' }} />
                      <div className="w-0.5 h-1.5 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '300ms' }} />
                    </div>
                  ) : (
                    <Play className="h-3 w-3" />
                  )}
                </Button>
              )}
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  return (
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
        <RadioGroup 
          value={selectedVoiceId || ''} 
          onValueChange={onSelect}
          className="grid gap-3"
        >
          {voices.map((voice, index) => (
            <div 
              key={voice.voice_id} 
              className={`flex items-center justify-between p-4 rounded-xl border transition-all duration-300 animate-fade-in cursor-pointer group ${
                playingId === voice.voice_id
                  ? 'border-primary bg-primary/10 shadow-lg scale-[1.02] ring-2 ring-primary/20'
                  : selectedVoiceId === voice.voice_id 
                    ? 'border-primary bg-primary/5 shadow-md' 
                    : 'border-border hover:border-primary/50 hover:bg-muted/30 hover:shadow-lg hover:scale-[1.01] hover:-translate-y-0.5'
              }`}
              style={{ animationDelay: `${index * 75}ms`, animationFillMode: 'backwards' }}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value={voice.voice_id} id={`voice-${voice.voice_id}`} />
                <div className="flex items-center gap-2">
                  {playingId === voice.voice_id && (
                    <div className="flex items-center gap-0.5 h-4">
                      <div className="w-1 h-3 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '0ms' }} />
                      <div className="w-1 h-4 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '150ms' }} />
                      <div className="w-1 h-2 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '300ms' }} />
                      <div className="w-1 h-3 bg-primary rounded-full animate-audio-wave" style={{ animationDelay: '450ms' }} />
                    </div>
                  )}
                  <div>
                    <Label 
                      htmlFor={`voice-${voice.voice_id}`} 
                      className={`cursor-pointer font-medium ${playingId === voice.voice_id ? 'animate-audio-pulse' : ''}`}
                    >
                      {voice.name}
                    </Label>
                    {voice.description && (
                      <p className="text-sm text-muted-foreground">{voice.description}</p>
                    )}
                    {voice.labels?.accent && (
                      <span className="text-xs text-muted-foreground">
                        {voice.labels.accent}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {voice.preview_url && (
                <Button
                  type="button"
                  variant={playingId === voice.voice_id ? "default" : "outline"}
                  size="sm"
                  className={`transition-all duration-200 ${
                    playingId === voice.voice_id 
                      ? 'bg-primary text-primary-foreground shadow-md' 
                      : 'group-hover:bg-primary/10 group-hover:border-primary/50'
                  }`}
                  onClick={(e) => {
                    e.preventDefault();
                    playPreview(voice);
                  }}
                >
                  {playingId === voice.voice_id ? (
                    <>
                      <div className="flex items-center gap-0.5 ml-1">
                        <div className="w-0.5 h-2 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '0ms' }} />
                        <div className="w-0.5 h-3 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '150ms' }} />
                        <div className="w-0.5 h-1.5 bg-primary-foreground rounded-full animate-audio-wave" style={{ animationDelay: '300ms' }} />
                      </div>
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
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
