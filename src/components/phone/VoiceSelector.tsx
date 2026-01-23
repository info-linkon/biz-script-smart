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
          {voices.map((voice) => (
            <div key={voice.voice_id} className="flex items-center space-x-2 space-x-reverse">
              <RadioGroupItem value={voice.voice_id} id={voice.voice_id} />
              <Label 
                htmlFor={voice.voice_id} 
                className="flex-1 cursor-pointer text-sm"
              >
                {voice.name}
              </Label>
              {voice.preview_url && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={(e) => {
                    e.preventDefault();
                    playPreview(voice);
                  }}
                >
                  {playingId === voice.voice_id ? (
                    <Pause className="h-3 w-3" />
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
          {voices.map((voice) => (
            <div 
              key={voice.voice_id} 
              className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                selectedVoiceId === voice.voice_id 
                  ? 'border-primary bg-primary/5' 
                  : 'border-border hover:border-primary/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <RadioGroupItem value={voice.voice_id} id={`voice-${voice.voice_id}`} />
                <div>
                  <Label 
                    htmlFor={`voice-${voice.voice_id}`} 
                    className="cursor-pointer font-medium"
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
              {voice.preview_url && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault();
                    playPreview(voice);
                  }}
                >
                  {playingId === voice.voice_id ? (
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
          ))}
        </RadioGroup>
      </CardContent>
    </Card>
  );
}
