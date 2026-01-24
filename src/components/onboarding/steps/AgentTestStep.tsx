import { useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, Phone, PhoneOff, Volume2, Loader2, ArrowLeft, ArrowRight, Languages, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

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
  const { user } = useAuth();
  const [isConnecting, setIsConnecting] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasTestedAgent, setHasTestedAgent] = useState(false);
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [agentExists, setAgentExists] = useState(false);
  const [checkingAgent, setCheckingAgent] = useState(true);

  // Check if agent exists on mount
  useEffect(() => {
    const checkAgentExists = async () => {
      if (!user) return;
      
      try {
        const { data: profile } = await supabase
          .from('profiles')
          .select('dialogflow_agent_id')
          .eq('user_id', user.id)
          .maybeSingle();

        setAgentExists(!!(profile as any)?.dialogflow_agent_id);
      } catch (error) {
        console.error('Error checking agent:', error);
      } finally {
        setCheckingAgent(false);
      }
    };

    checkAgentExists();
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

      // Get credentials for Google Dialogflow
      const { data: credentials, error } = await supabase.functions.invoke('google-get-credentials');
      
      if (error || !credentials?.success) {
        console.error("Failed to get credentials:", error || credentials?.error);
        toast.error("שגיאה בהתחברות לסוכן");
        setIsConnecting(false);
        return;
      }

      // For now, show a message that testing is available after phone setup
      toast.info("בדיקת הסוכן תהיה זמינה לאחר רכישת מספר טלפון");
      setHasTestedAgent(true);
      setIsConnecting(false);

    } catch (error) {
      console.error("Failed to start test:", error);
      toast.error("שגיאה בהתחלת הבדיקה");
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [user]);

  const stopTest = useCallback(async () => {
    setIsConnected(false);
    setHasTestedAgent(true);
  }, []);

  if (checkingAgent) {
    return (
      <Card className="border-0 shadow-xl bg-card/80 backdrop-blur">
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-0 shadow-xl bg-card/80 backdrop-blur">
      <CardHeader className="text-center pb-2">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 shadow-lg">
          <Phone className="h-8 w-8 text-white" />
        </div>
        <CardTitle className="text-2xl">בדיקת הסוכן</CardTitle>
        <CardDescription className="text-base">
          הסוכן שלך משתמש ב-Google Dialogflow CX עם זיהוי עברית מצוין
        </CardDescription>
        {/* Provider indicator */}
        <div className="mt-2 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-muted text-sm">
          <span>🎯</span>
          <span>ספק: Google Dialogflow CX</span>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Connection Status */}
        <div className="flex flex-col items-center gap-4 p-6 rounded-xl bg-muted/50">
          <div className="h-16 w-16 rounded-full bg-gradient-to-br from-green-500 to-teal-600 flex items-center justify-center shadow-lg">
            <Mic className="h-8 w-8 text-white" />
          </div>
          
          {micPermissionDenied ? (
            <div className="text-center">
              <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
              <p className="text-destructive font-medium">נדרשת הרשאת מיקרופון</p>
              <p className="text-sm text-muted-foreground">
                אפשר גישה למיקרופון כדי לבדוק את הסוכן
              </p>
            </div>
          ) : (
            <>
              <p className="text-center text-muted-foreground">
                לחץ על "התחל שיחה" כדי לבדוק את הסוכן הקולי שלך
              </p>
              <Button
                onClick={startTest}
                disabled={isConnecting}
                className="gradient-primary text-white px-8"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    מתחבר...
                  </>
                ) : (
                  <>
                    <Phone className="ml-2 h-4 w-4" />
                    התחל שיחה
                  </>
                )}
              </Button>
            </>
          )}
        </div>

        {/* Messages */}
        {messages.length > 0 && (
          <ScrollArea className="h-48 rounded-lg bg-muted/30 p-4">
            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-xl ${
                      msg.role === 'user'
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Navigation */}
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
            onClick={onComplete}
            className="flex-1 gradient-primary text-white"
          >
            המשך
            <ArrowLeft className="mr-2 h-4 w-4" />
          </Button>
        </div>

        <p className="text-xs text-center text-muted-foreground">
          💡 בדיקה מלאה תהיה זמינה לאחר רכישת מספר טלפון
        </p>
      </CardContent>
    </Card>
  );
}
