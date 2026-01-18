import { useState, useEffect, useCallback, useRef } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Mic, MicOff, Phone, PhoneOff, MessageSquare, Send, Loader2, Volume2, VolumeX, Bot, User } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function Agent() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'voice' | 'chat'>('voice');
  
  // Voice state
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState<Message[]>([]);
  
  // Chat state
  const [chatMessages, setChatMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  
  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const callStartTime = useRef<Date | null>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [voiceTranscript, chatMessages]);

  const startVoiceCall = async () => {
    setIsConnecting(true);
    
    try {
      // Request microphone permission
      await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // For demo purposes, simulate connection
      // In production, this would connect to ElevenLabs
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      setIsConnected(true);
      callStartTime.current = new Date();
      
      // Add welcome message
      setVoiceTranscript([{
        role: 'assistant',
        content: 'שלום! אני הסוכן הקולי של העסק. איך אוכל לעזור לך היום?',
        timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      }]);
      
      toast.success('השיחה התחילה');
    } catch (error) {
      console.error('Error starting voice call:', error);
      toast.error('לא ניתן להתחיל שיחה', {
        description: 'נא לאפשר גישה למיקרופון',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  const endVoiceCall = async () => {
    setIsConnected(false);
    setIsSpeaking(false);
    
    // Calculate duration
    const duration = callStartTime.current 
      ? Math.round((new Date().getTime() - callStartTime.current.getTime()) / 1000)
      : 0;
    
    // Save call to database
    if (user && voiceTranscript.length > 0) {
      try {
        await supabase.from('calls').insert({
          user_id: user.id,
          call_type: 'voice',
          transcript: voiceTranscript as unknown as null,
          summary: 'שיחה עם סוכן AI',
          duration_seconds: duration,
          status: 'completed',
          language: 'he',
        });
      } catch (error) {
        console.error('Error saving call:', error);
      }
    }
    
    setVoiceTranscript([]);
    callStartTime.current = null;
    toast.info('השיחה הסתיימה');
  };

  const sendChatMessage = async () => {
    if (!inputMessage.trim() || isSending) return;
    
    const userMessage: Message = {
      role: 'user',
      content: inputMessage.trim(),
      timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    };
    
    setChatMessages(prev => [...prev, userMessage]);
    setInputMessage('');
    setIsSending(true);
    
    try {
      // Call the AI chat function
      const response = await supabase.functions.invoke('ai-chat', {
        body: { 
          messages: [...chatMessages, userMessage].map(m => ({ role: m.role, content: m.content })),
          userId: user?.id,
        },
      });
      
      if (response.error) throw response.error;
      
      const assistantMessage: Message = {
        role: 'assistant',
        content: response.data?.message || 'מצטער, לא הצלחתי לעבד את הבקשה. נסה שוב.',
        timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      };
      
      setChatMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Fallback response for demo
      const fallbackMessage: Message = {
        role: 'assistant',
        content: 'שלום! אני הסוכן של העסק. כרגע אני במצב הדגמה. כדי לקבל תגובות מלאות, יש להגדיר את ElevenLabs Agent.',
        timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      };
      
      setChatMessages(prev => [...prev, fallbackMessage]);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // Demo: Simulate voice interaction
  const simulateVoiceInteraction = () => {
    if (!isConnected) return;
    
    setIsSpeaking(true);
    
    const userMessages = [
      'מה שעות הפעילות שלכם?',
      'אני רוצה לקבוע פגישה',
      'מה המחירים שלכם?',
    ];
    
    const responses = [
      'אנחנו פתוחים בימים א\'-ה\' בין השעות 09:00-18:00, וביום ו\' עד 14:00.',
      'בשמחה! מתי יתאים לך? יש לי פנוי ביום ראשון בשעה 10:00 או ביום שלישי בשעה 14:00.',
      'המחירים שלנו מתחילים מ-150 ש"ח לשירות בסיסי. אשמח לתת לך פרטים נוספים.',
    ];
    
    const randomIndex = Math.floor(Math.random() * userMessages.length);
    
    // Add user message
    setTimeout(() => {
      setVoiceTranscript(prev => [...prev, {
        role: 'user',
        content: userMessages[randomIndex],
        timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      }]);
      
      // Add assistant response
      setTimeout(() => {
        setVoiceTranscript(prev => [...prev, {
          role: 'assistant',
          content: responses[randomIndex],
          timestamp: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        }]);
        setIsSpeaking(false);
      }, 1500);
    }, 500);
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center">
          <div className="mx-auto mb-4 h-20 w-20 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/25">
            <Bot className="h-10 w-10 text-white" />
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold">סוכן AI</h1>
          <p className="text-muted-foreground">שוחח עם הסוכן בקול או בטקסט</p>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'voice' | 'chat')} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="voice" className="gap-2">
              <Phone className="h-4 w-4" />
              שיחה קולית
            </TabsTrigger>
            <TabsTrigger value="chat" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              צ'אט טקסט
            </TabsTrigger>
          </TabsList>

          {/* Voice Tab */}
          <TabsContent value="voice">
            <Card className="border-0 shadow-lg">
              <CardContent className="p-6">
                {/* Voice Status */}
                <div className="text-center mb-6">
                  <div className={`mx-auto mb-4 h-32 w-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                    isConnected 
                      ? isSpeaking 
                        ? 'bg-green-500 animate-pulse-slow shadow-lg shadow-green-500/50' 
                        : 'bg-primary shadow-lg shadow-primary/50'
                      : 'bg-secondary'
                  }`}>
                    {isConnecting ? (
                      <Loader2 className="h-12 w-12 text-white animate-spin" />
                    ) : isConnected ? (
                      <Mic className={`h-12 w-12 text-white ${isSpeaking ? 'animate-pulse' : ''}`} />
                    ) : (
                      <MicOff className="h-12 w-12 text-muted-foreground" />
                    )}
                  </div>
                  
                  <Badge 
                    variant={isConnected ? 'default' : 'secondary'}
                    className="text-sm"
                  >
                    {isConnecting ? 'מתחבר...' : isConnected ? (isSpeaking ? 'מדבר...' : 'מחובר - מאזין') : 'לא מחובר'}
                  </Badge>
                </div>

                {/* Voice Controls */}
                <div className="flex justify-center gap-4 mb-6">
                  {!isConnected ? (
                    <Button
                      size="lg"
                      className="gradient-primary text-white px-8"
                      onClick={startVoiceCall}
                      disabled={isConnecting}
                    >
                      {isConnecting ? (
                        <>
                          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                          מתחבר...
                        </>
                      ) : (
                        <>
                          <Phone className="ml-2 h-5 w-5" />
                          התחל שיחה
                        </>
                      )}
                    </Button>
                  ) : (
                    <>
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={() => setIsMuted(!isMuted)}
                      >
                        {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                      </Button>
                      <Button
                        size="lg"
                        variant="outline"
                        onClick={simulateVoiceInteraction}
                        disabled={isSpeaking}
                      >
                        <Mic className="h-5 w-5" />
                      </Button>
                      <Button
                        size="lg"
                        variant="destructive"
                        onClick={endVoiceCall}
                      >
                        <PhoneOff className="ml-2 h-5 w-5" />
                        סיים שיחה
                      </Button>
                    </>
                  )}
                </div>

                {/* Voice Transcript */}
                {voiceTranscript.length > 0 && (
                  <div className="border-t pt-4">
                    <h4 className="font-medium mb-3 text-center">תמלול בזמן אמת</h4>
                    <ScrollArea className="h-48 rounded-xl bg-secondary/30 p-4" ref={scrollRef}>
                      <div className="space-y-3">
                        {voiceTranscript.map((msg, i) => (
                          <div
                            key={i}
                            className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                          >
                            <div
                              className={`max-w-[80%] p-3 rounded-xl text-sm ${
                                msg.role === 'user'
                                  ? 'bg-secondary text-foreground'
                                  : 'bg-primary text-primary-foreground'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                {msg.role === 'user' ? (
                                  <User className="h-3 w-3" />
                                ) : (
                                  <Bot className="h-3 w-3" />
                                )}
                                <span className="text-xs opacity-70">{msg.timestamp}</span>
                              </div>
                              <p>{msg.content}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ElevenLabs Notice */}
            <Card className="border-dashed mt-4">
              <CardContent className="p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  💡 לחוויה קולית מלאה עם זיהוי דיבור וקביעת פגישות אוטומטית,
                  יש להגדיר חיבור ל-ElevenLabs Agent.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Chat Tab */}
          <TabsContent value="chat">
            <Card className="border-0 shadow-lg">
              <CardContent className="p-0">
                {/* Chat Messages */}
                <ScrollArea className="h-[400px] p-4" ref={scrollRef}>
                  {chatMessages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground">
                      <MessageSquare className="h-12 w-12 mb-4 opacity-20" />
                      <p>התחל שיחה עם הסוכן</p>
                      <p className="text-sm">שאל שאלות, קבע פגישות, ועוד</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {chatMessages.map((msg, i) => (
                        <div
                          key={i}
                          className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}
                        >
                          <div
                            className={`max-w-[80%] p-4 rounded-2xl ${
                              msg.role === 'user'
                                ? 'bg-secondary text-foreground rounded-tr-sm'
                                : 'bg-primary text-primary-foreground rounded-tl-sm'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              {msg.role === 'user' ? (
                                <User className="h-3 w-3" />
                              ) : (
                                <Bot className="h-3 w-3" />
                              )}
                              <span className="text-xs opacity-70">{msg.timestamp}</span>
                            </div>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                        </div>
                      ))}
                      {isSending && (
                        <div className="flex justify-end">
                          <div className="bg-primary/50 text-primary-foreground p-4 rounded-2xl rounded-tl-sm">
                            <Loader2 className="h-5 w-5 animate-spin" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </ScrollArea>

                {/* Chat Input */}
                <div className="border-t p-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="הקלד הודעה..."
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={handleKeyPress}
                      disabled={isSending}
                      className="flex-1"
                    />
                    <Button
                      onClick={sendChatMessage}
                      disabled={!inputMessage.trim() || isSending}
                      className="gradient-primary text-white"
                    >
                      {isSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}