import { useState, useCallback, useEffect } from 'react';
import { useConversation } from '@elevenlabs/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, MicOff, Phone, PhoneOff, Volume2, Loader2, ArrowLeft, ArrowRight, Languages } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface AgentTestStepProps {
  onComplete: () => void;
  onBack: () => void;
}

interface Message {
  role: 'user' | 'agent';
  text: string;
  timestamp: Date;
}

export function AgentTestStep({ onComplete, onBack }: AgentTestStepProps) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasTestedAgent, setHasTestedAgent] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);

  const conversation = useConversation({
    onConnect: () => {
      console.log("Connected to agent");
      toast.success("מחובר לסוכן! אפשר להתחיל לדבר");
    },
    onDisconnect: () => {
      console.log("Disconnected from agent");
      if (messages.length > 0) {
        setHasTestedAgent(true);
      }
    },
    onMessage: (message: unknown) => {
      console.log("Message received:", message);
      
      const msg = message as { type?: string; user_transcription_event?: { user_transcript?: string }; agent_response_event?: { agent_response?: string } };
      
      if (msg.type === "user_transcript") {
        const transcript = msg.user_transcription_event?.user_transcript;
        if (transcript) {
          setMessages(prev => [...prev, {
            role: 'user',
            text: transcript,
            timestamp: new Date()
          }]);
        }
      }
      
      if (msg.type === "agent_response") {
        const response = msg.agent_response_event?.agent_response;
        if (response) {
          setMessages(prev => [...prev, {
            role: 'agent',
            text: response,
            timestamp: new Date()
          }]);
        }
      }
    },
    onError: (error: unknown) => {
      console.error("Conversation error:", error);
      toast.error("שגיאה בהתחברות לסוכן");
      setIsConnecting(false);
    },
  });

  const startTest = useCallback(async () => {
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

      // Get signed URL from edge function
      const { data, error } = await supabase.functions.invoke('elevenlabs-conversation-token');

      if (error || !data?.signed_url) {
        console.error("Failed to get conversation token:", error);
        toast.error("שגיאה בהתחברות לסוכן");
        setIsConnecting(false);
        return;
      }

      console.log("Got signed URL, starting session...");

      // Start the conversation with WebSocket
      await conversation.startSession({
        signedUrl: data.signed_url,
      });

    } catch (error) {
      console.error("Failed to start test:", error);
      toast.error("שגיאה בהתחלת הבדיקה");
    } finally {
      setIsConnecting(false);
    }
  }, [conversation]);

  const stopTest = useCallback(async () => {
    await conversation.endSession();
    setHasTestedAgent(true);
  }, [conversation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (conversation.status === 'connected') {
        conversation.endSession();
      }
    };
  }, [conversation]);

  const isConnected = conversation.status === 'connected';
  const isSpeaking = conversation.isSpeaking;

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
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="flex items-center justify-center gap-3 p-4 rounded-xl bg-muted/50">
          <div className={`h-4 w-4 rounded-full transition-all ${
            isConnected 
              ? isSpeaking 
                ? 'bg-accent animate-pulse shadow-lg shadow-accent/50' 
                : 'bg-green-500 animate-pulse shadow-lg shadow-green-500/50'
              : 'bg-muted-foreground/30'
          }`} />
          <span className="text-lg font-medium">
            {isConnected 
              ? isSpeaking 
                ? '🎤 הסוכן מדבר...' 
                : '👂 הסוכן מקשיב...'
              : '⏸️ לא מחובר'
            }
          </span>
        </div>

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
          <ScrollArea className="h-64 p-4">
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
