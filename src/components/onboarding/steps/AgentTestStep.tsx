import { useState, useCallback, useEffect, useRef } from 'react';
import { useConversation } from '@elevenlabs/react';
import Vapi from '@vapi-ai/web';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, Phone, PhoneOff, Volume2, Loader2, ArrowLeft, ArrowRight, Languages } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { getVoiceProvider, getVoiceProviderCredentials, type VoiceProvider } from '@/lib/voice-provider';

interface AgentTestStepProps {
  onComplete: () => void;
  onBack: () => void;
}

interface Message {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

// Audio Visualizer Component
function AudioVisualizer({ 
  isActive, 
  type,
  getVolume 
}: { 
  isActive: boolean; 
  type: 'input' | 'output';
  getVolume: () => number;
}) {
  const [levels, setLevels] = useState<number[]>(Array(12).fill(0));
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      setLevels(Array(12).fill(0));
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const updateLevels = () => {
      const volume = getVolume();
      
      setLevels(prev => {
        const newLevels = [...prev];
        for (let i = 0; i < newLevels.length - 1; i++) {
          newLevels[i] = newLevels[i + 1];
        }
        const normalizedVolume = Math.min(volume * 2, 1);
        const variation = (Math.random() - 0.5) * 0.2;
        newLevels[newLevels.length - 1] = Math.max(0.1, Math.min(1, normalizedVolume + variation));
        return newLevels;
      });

      animationRef.current = requestAnimationFrame(updateLevels);
    };

    animationRef.current = requestAnimationFrame(updateLevels);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, getVolume]);

  const barColor = type === 'input' ? 'bg-green-500' : 'bg-primary';

  return (
    <div className="flex items-center justify-center gap-1 h-12">
      {levels.map((level, i) => (
        <div
          key={i}
          className={`w-1.5 rounded-full transition-all duration-75 ${barColor}`}
          style={{
            height: `${Math.max(4, level * 48)}px`,
            opacity: isActive ? 0.7 + level * 0.3 : 0.2,
          }}
        />
      ))}
    </div>
  );
}

// Circular Waveform Component
function CircularWaveform({ 
  isActive, 
  isSpeaking,
  getInputVolume,
  getOutputVolume
}: { 
  isActive: boolean;
  isSpeaking: boolean;
  getInputVolume: () => number;
  getOutputVolume: () => number;
}) {
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isActive) {
      setInputLevel(0);
      setOutputLevel(0);
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      return;
    }

    const updateLevels = () => {
      const input = getInputVolume();
      const output = getOutputVolume();
      
      setInputLevel(prev => prev * 0.8 + input * 0.2);
      setOutputLevel(prev => prev * 0.8 + output * 0.2);

      animationRef.current = requestAnimationFrame(updateLevels);
    };

    animationRef.current = requestAnimationFrame(updateLevels);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isActive, getInputVolume, getOutputVolume]);

  const scale = 1 + (isSpeaking ? outputLevel : inputLevel) * 0.3;
  const glowIntensity = isSpeaking ? outputLevel * 30 : inputLevel * 30;

  return (
    <div className="relative flex items-center justify-center">
      <div 
        className={`absolute w-24 h-24 rounded-full transition-all duration-150 ${
          isSpeaking ? 'bg-primary/20' : 'bg-green-500/20'
        }`}
        style={{
          transform: `scale(${scale * 1.2})`,
          filter: `blur(${glowIntensity}px)`,
        }}
      />
      
      <div 
        className={`absolute w-20 h-20 rounded-full border-2 transition-all duration-100 ${
          isSpeaking 
            ? 'border-primary/60' 
            : 'border-green-500/60'
        }`}
        style={{
          transform: `scale(${scale})`,
        }}
      />
      
      <div 
        className={`relative w-16 h-16 rounded-full flex items-center justify-center transition-all duration-100 ${
          isSpeaking 
            ? 'bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/40' 
            : 'bg-gradient-to-br from-green-500 to-green-600 shadow-lg shadow-green-500/40'
        }`}
        style={{
          transform: `scale(${1 + (isSpeaking ? outputLevel : inputLevel) * 0.15})`,
        }}
      >
        {isSpeaking ? (
          <Volume2 className="h-7 w-7 text-white" />
        ) : (
          <Mic className="h-7 w-7 text-white" />
        )}
      </div>

      {isActive && (
        <>
          <div 
            className={`absolute w-16 h-16 rounded-full border transition-all ${
              isSpeaking ? 'border-primary/40' : 'border-green-500/40'
            } animate-ping`}
            style={{ animationDuration: '1.5s' }}
          />
          <div 
            className={`absolute w-16 h-16 rounded-full border transition-all ${
              isSpeaking ? 'border-primary/20' : 'border-green-500/20'
            } animate-ping`}
            style={{ animationDuration: '2s', animationDelay: '0.5s' }}
          />
        </>
      )}
    </div>
  );
}

export function AgentTestStep({ onComplete, onBack }: AgentTestStepProps) {
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasTestedAgent, setHasTestedAgent] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<VoiceProvider>('elevenlabs');
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Vapi instance ref
  const vapiRef = useRef<Vapi | null>(null);
  
  // Volume levels for visualization
  const inputVolumeRef = useRef(0);
  const outputVolumeRef = useRef(0);

  // ElevenLabs conversation hook
  const elevenLabsConversation = useConversation({
    onConnect: () => {
      console.log("Connected to ElevenLabs agent");
      setIsConnected(true);
      toast.success("מחובר לסוכן! אפשר להתחיל לדבר");
    },
    onDisconnect: () => {
      console.log("Disconnected from ElevenLabs agent");
      setIsConnected(false);
      if (messages.length > 0) {
        setHasTestedAgent(true);
      }
    },
    onMessage: (message: unknown) => {
      console.log("ElevenLabs message:", message);
      const msg = message as { type?: string; user_transcription_event?: { user_transcript?: string }; agent_response_event?: { agent_response?: string } };
      
      if (msg.type === "user_transcript") {
        const transcript = msg.user_transcription_event?.user_transcript;
        if (transcript) {
          setMessages(prev => [...prev, { role: 'user', text: transcript, timestamp: new Date() }]);
        }
      }
      
      if (msg.type === "agent_response") {
        const response = msg.agent_response_event?.agent_response;
        if (response) {
          setMessages(prev => [...prev, { role: 'agent', text: response, timestamp: new Date() }]);
        }
      }
    },
    onError: (error: unknown) => {
      console.error("ElevenLabs error:", error);
      toast.error("שגיאה בהתחברות לסוכן");
      setIsConnecting(false);
      setIsConnected(false);
    },
  });

  // Initialize Vapi event handlers
  const setupVapiEventHandlers = useCallback((vapi: Vapi) => {
    vapi.on('call-start', () => {
      console.log("Vapi call started");
      setIsConnected(true);
      toast.success("מחובר לסוכן! אפשר להתחיל לדבר");
    });

    vapi.on('call-end', () => {
      console.log("Vapi call ended");
      setIsConnected(false);
      if (messages.length > 0) {
        setHasTestedAgent(true);
      }
    });

    vapi.on('speech-start', () => {
      setIsSpeaking(true);
    });

    vapi.on('speech-end', () => {
      setIsSpeaking(false);
    });

    vapi.on('message', (message: any) => {
      console.log("Vapi message:", message);
      
      if (message.type === 'transcript' && message.transcriptType === 'final') {
        if (message.role === 'user') {
          setMessages(prev => [...prev, { role: 'user', text: message.transcript, timestamp: new Date() }]);
        } else if (message.role === 'assistant') {
          setMessages(prev => [...prev, { role: 'agent', text: message.transcript, timestamp: new Date() }]);
        }
      }
    });

    vapi.on('volume-level', (volume: number) => {
      outputVolumeRef.current = volume;
    });

    vapi.on('error', (error: any) => {
      console.error("Vapi error:", error);
      toast.error("שגיאה בהתחברות לסוכן");
      setIsConnecting(false);
      setIsConnected(false);
    });
  }, [messages.length]);

  // Fetch current provider on mount
  useEffect(() => {
    if (user) {
      getVoiceProvider(user.id).then(config => {
        setCurrentProvider(config.provider);
      });
    }
  }, [user]);

  const startTest = useCallback(async () => {
    if (!user) return;
    
    setIsConnecting(true);
    setMessages([]);
    
    try {
      // Request microphone permission
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        console.error("Microphone permission denied:", micError);
        setMicPermissionDenied(true);
        toast.error("נדרשת הרשאת מיקרופון לבדיקת הסוכן");
        setIsConnecting(false);
        return;
      }

      // Get current provider config
      const providerConfig = await getVoiceProvider(user.id);
      setCurrentProvider(providerConfig.provider);

      // Get credentials for the provider
      const credentials = await getVoiceProviderCredentials(providerConfig.provider);
      
      if (!credentials.success) {
        console.error("Failed to get credentials:", credentials.error);
        toast.error("שגיאה בהתחברות לסוכן");
        setIsConnecting(false);
        return;
      }

      if (providerConfig.provider === 'vapi') {
        // Start Vapi conversation
        console.log("Starting Vapi conversation with assistant:", credentials.assistant_id);
        
        if (!credentials.public_key || !credentials.assistant_id) {
          throw new Error("Missing Vapi credentials");
        }

        const vapi = new Vapi(credentials.public_key);
        vapiRef.current = vapi;
        setupVapiEventHandlers(vapi);
        
        await vapi.start(credentials.assistant_id);
        
      } else {
        // Start ElevenLabs conversation
        console.log("Starting ElevenLabs conversation with signed URL");
        
        if (!credentials.signed_url) {
          throw new Error("Missing ElevenLabs signed URL");
        }

        await elevenLabsConversation.startSession({
          signedUrl: credentials.signed_url,
        });
      }

    } catch (error) {
      console.error("Failed to start test:", error);
      toast.error("שגיאה בהתחלת הבדיקה");
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [user, elevenLabsConversation, setupVapiEventHandlers]);

  const stopTest = useCallback(async () => {
    if (currentProvider === 'vapi' && vapiRef.current) {
      vapiRef.current.stop();
      vapiRef.current = null;
    } else {
      await elevenLabsConversation.endSession();
    }
    setIsConnected(false);
    setHasTestedAgent(true);
  }, [currentProvider, elevenLabsConversation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (vapiRef.current) {
        vapiRef.current.stop();
        vapiRef.current = null;
      }
      if (elevenLabsConversation.status === 'connected') {
        elevenLabsConversation.endSession();
      }
    };
  }, [elevenLabsConversation]);

  // Update isSpeaking for ElevenLabs
  useEffect(() => {
    if (currentProvider === 'elevenlabs') {
      setIsSpeaking(elevenLabsConversation.isSpeaking);
      setIsConnected(elevenLabsConversation.status === 'connected');
    }
  }, [currentProvider, elevenLabsConversation.isSpeaking, elevenLabsConversation.status]);

  // Volume getters
  const getInputVolume = useCallback(() => {
    if (currentProvider === 'vapi') {
      return inputVolumeRef.current;
    }
    try {
      return elevenLabsConversation.getInputVolume?.() ?? 0;
    } catch {
      return 0;
    }
  }, [currentProvider, elevenLabsConversation]);

  const getOutputVolume = useCallback(() => {
    if (currentProvider === 'vapi') {
      return outputVolumeRef.current;
    }
    try {
      return elevenLabsConversation.getOutputVolume?.() ?? 0;
    } catch {
      return 0;
    }
  }, [currentProvider, elevenLabsConversation]);

  return (
    <Card className="border-0 shadow-xl bg-card/80 backdrop-blur">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 shadow-lg">
          <Phone className="h-8 w-8 text-white" />
        </div>
        <CardTitle className="text-2xl">בדיקת הסוכן</CardTitle>
        <CardDescription className="text-base">
          דבר עם הסוכן ובדוק שהוא מבין אותך • נסה לדבר בעברית, ערבית או אנגלית
        </CardDescription>
        {/* Provider indicator */}
        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
          <span>{currentProvider === 'vapi' ? '🌍' : '⚡'}</span>
          <span>ספק: {currentProvider === 'vapi' ? 'Vapi.ai (עברית מלאה)' : 'ElevenLabs'}</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Audio Visualizer */}
        {isConnected && (
          <div className="flex flex-col items-center gap-4 py-4">
            <CircularWaveform
              isActive={isConnected}
              isSpeaking={isSpeaking}
              getInputVolume={getInputVolume}
              getOutputVolume={getOutputVolume}
            />
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className={`transition-colors ${!isSpeaking ? 'text-green-500' : 'text-muted-foreground'}`}>
                🎙️ אתה
              </span>
              <span className="text-muted-foreground">|</span>
              <span className={`transition-colors ${isSpeaking ? 'text-primary' : 'text-muted-foreground'}`}>
                🤖 הסוכן
              </span>
            </div>
            
            {/* Audio Level Bars */}
            <div className="w-full grid grid-cols-2 gap-4 mt-2">
              <div className="space-y-1">
                <p className="text-xs text-center text-muted-foreground">המיקרופון שלך</p>
                <div className="bg-muted/50 rounded-lg p-2">
                  <AudioVisualizer 
                    isActive={isConnected && !isSpeaking} 
                    type="input"
                    getVolume={getInputVolume}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-center text-muted-foreground">קול הסוכן</p>
                <div className="bg-muted/50 rounded-lg p-2">
                  <AudioVisualizer 
                    isActive={isConnected && isSpeaking} 
                    type="output"
                    getVolume={getOutputVolume}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connection Status */}
        {!isConnected && (
          <div className="flex items-center justify-center gap-3 p-4 rounded-xl bg-muted/50">
            <div className="h-4 w-4 rounded-full bg-muted-foreground/30" />
            <span className="text-lg font-medium">⏸️ לא מחובר</span>
          </div>
        )}

        {/* Language Tips */}
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 text-sm">
          <Languages className="h-5 w-5 text-primary shrink-0" />
          <span>הסוכן יזהה אוטומטית את השפה שלך ויענה באותה שפה</span>
        </div>

        {/* Transcript */}
        <div className="bg-muted/30 rounded-xl border">
          <div className="p-3 border-b bg-muted/50 rounded-t-xl">
            <span className="font-medium text-sm">תמלול השיחה</span>
          </div>
          <ScrollArea className="h-48 p-4">
            {messages.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                {isConnected 
                  ? "התחל לדבר... הסוכן מקשיב 🎧"
                  : "לחץ על 'התחל בדיקה' כדי לדבר עם הסוכן"
                }
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((msg, i) => (
                  <div 
                    key={i} 
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] px-4 py-2 rounded-2xl ${
                      msg.role === 'user' 
                        ? 'bg-primary text-primary-foreground rounded-br-md' 
                        : 'bg-card border rounded-bl-md'
                    }`}>
                      <p className="text-sm">{msg.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Microphone Permission Error */}
        {micPermissionDenied && (
          <div className="p-4 rounded-lg bg-destructive/10 text-destructive text-sm">
            <p className="font-medium">נדרשת הרשאת מיקרופון</p>
            <p className="mt-1">אנא אפשר גישה למיקרופון בהגדרות הדפדפן ונסה שוב</p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="space-y-4">
          {!isConnected ? (
            <Button 
              onClick={startTest} 
              disabled={isConnecting}
              className="w-full h-14 text-lg gap-3"
              size="lg"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  מתחבר לסוכן...
                </>
              ) : (
                <>
                  <Mic className="h-5 w-5" />
                  התחל שיחת בדיקה
                </>
              )}
            </Button>
          ) : (
            <Button 
              onClick={stopTest}
              variant="destructive"
              className="w-full h-14 text-lg gap-3"
              size="lg"
            >
              <PhoneOff className="h-5 w-5" />
              סיים שיחה
            </Button>
          )}

          {/* Navigation */}
          <div className="flex gap-3 pt-2">
            <Button 
              variant="outline" 
              onClick={onBack}
              className="flex-1 gap-2"
              disabled={isConnected}
            >
              <ArrowRight className="h-4 w-4" />
              חזור
            </Button>
            <Button 
              onClick={onComplete}
              className="flex-1 gap-2"
              disabled={isConnected}
            >
              {hasTestedAgent ? 'הסוכן עובד! המשך' : 'דלג והמשך'}
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Help Text */}
        {!isConnected && !hasTestedAgent && (
          <p className="text-center text-sm text-muted-foreground">
            💡 מומלץ לבדוק את הסוכן לפני רכישת מספר טלפון
          </p>
        )}
      </CardContent>
    </Card>
  );
}
