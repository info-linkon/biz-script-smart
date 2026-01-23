import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Phone, MessageSquare, Search, Clock, User, Calendar, Loader2, FileText, Languages } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

const LANGUAGE_LABELS: Record<string, { label: string; flag: string }> = {
  he: { label: 'עברית', flag: '🇮🇱' },
  ar: { label: 'ערבית', flag: '🇸🇦' },
  en: { label: 'English', flag: '🇺🇸' },
};

interface TranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface Call {
  id: string;
  call_type: string;
  caller_name: string | null;
  caller_phone: string | null;
  transcript: TranscriptMessage[];
  summary: string | null;
  duration_seconds: number | null;
  status: string;
  language: string;
  created_at: string;
}

export default function Calls() {
  const { user } = useAuth();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (user) {
      fetchCalls();
    }
  }, [user]);

  const fetchCalls = async () => {
    try {
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data
      const transformedData = (data || []).map(call => ({
        ...call,
        transcript: Array.isArray(call.transcript) ? (call.transcript as unknown as TranscriptMessage[]) : []
      }));
      
      setCalls(transformedData);
    } catch (error) {
      console.error('Error fetching calls:', error);
      toast.error('שגיאה בטעינת השיחות');
    } finally {
      setLoading(false);
    }
  };

  const filteredCalls = calls.filter(call => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      call.caller_name?.toLowerCase().includes(query) ||
      call.caller_phone?.includes(query) ||
      call.summary?.toLowerCase().includes(query)
    );
    const matchesLanguage = languageFilter === 'all' || call.language === languageFilter;
    return matchesSearch && matchesLanguage;
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const openCallDetails = (call: Call) => {
    setSelectedCall(call);
    setDialogOpen(true);
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">היסטוריית שיחות</h1>
            <p className="text-muted-foreground">כל השיחות והצ'אטים עם לקוחות</p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={languageFilter} onValueChange={setLanguageFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="כל השפות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🌐 כל השפות</SelectItem>
                <SelectItem value="he">🇮🇱 עברית</SelectItem>
                <SelectItem value="ar">🇸🇦 ערבית</SelectItem>
                <SelectItem value="en">🇺🇸 English</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="חיפוש לפי שם, טלפון או תוכן..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10 w-full sm:w-64"
              />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{calls.filter(c => c.call_type === 'voice' || c.call_type === 'inbound').length}</p>
                  <p className="text-sm text-muted-foreground">שיחות קוליות</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{calls.filter(c => c.call_type === 'chat').length}</p>
                  <p className="text-sm text-muted-foreground">שיחות צ'אט</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{calls.filter(c => c.status === 'completed').length}</p>
                  <p className="text-sm text-muted-foreground">הושלמו</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-orange-500/10 flex items-center justify-center">
                  <Clock className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {calls.length > 0 
                      ? formatDuration(Math.round(calls.reduce((acc, c) => acc + (c.duration_seconds || 0), 0) / calls.length))
                      : '--:--'
                    }
                  </p>
                  <p className="text-sm text-muted-foreground">זמן ממוצע</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Languages className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <div className="flex items-center gap-1 text-lg font-bold">
                    <span title="עברית">🇮🇱 {calls.filter(c => c.language === 'he').length}</span>
                    <span className="text-muted-foreground mx-1">|</span>
                    <span title="ערבית">🇸🇦 {calls.filter(c => c.language === 'ar').length}</span>
                    <span className="text-muted-foreground mx-1">|</span>
                    <span title="אנגלית">🇺🇸 {calls.filter(c => c.language === 'en').length}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">שפות</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Calls List */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">שיחות אחרונות</CardTitle>
            <CardDescription>
              {filteredCalls.length} שיחות {searchQuery && 'נמצאו'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : filteredCalls.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Phone className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>{searchQuery ? 'לא נמצאו תוצאות' : 'אין שיחות עדיין'}</p>
                {!searchQuery && (
                  <Button
                    variant="link"
                    onClick={() => window.location.href = '/agent'}
                    className="mt-2"
                  >
                    התחל שיחה עם הסוכן
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCalls.map((call) => (
                  <div
                    key={call.id}
                    className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                    onClick={() => openCallDetails(call)}
                  >
                    <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${
                      call.call_type === 'voice' ? 'bg-primary/10' : 'bg-purple-500/10'
                    }`}>
                      {call.call_type === 'voice' ? (
                        <Phone className="h-5 w-5 text-primary" />
                      ) : (
                        <MessageSquare className="h-5 w-5 text-purple-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-medium truncate">
                          {call.caller_name || 'לקוח אנונימי'}
                        </h3>
                        <Badge variant="outline" className="text-xs">
                          {call.call_type === 'voice' || call.call_type === 'inbound' ? 'קולי' : 'צ\'אט'}
                        </Badge>
                        <Badge 
                          variant={call.status === 'completed' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          {call.status === 'completed' ? 'הושלם' : call.status === 'in_progress' ? 'פעיל' : call.status}
                        </Badge>
                        {/* Language Badge */}
                        <Badge variant="outline" className="text-xs gap-1">
                          <span>{LANGUAGE_LABELS[call.language]?.flag || '🌐'}</span>
                          <span>{LANGUAGE_LABELS[call.language]?.label || call.language}</span>
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground truncate mt-1">
                        {call.summary || 'אין סיכום זמין'}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium">
                        {formatDuration(call.duration_seconds)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(call.created_at), 'dd/MM HH:mm', { locale: he })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Call Details Dialog */}
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh]" dir="rtl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedCall?.call_type === 'voice' ? (
                  <Phone className="h-5 w-5 text-primary" />
                ) : (
                  <MessageSquare className="h-5 w-5 text-purple-600" />
                )}
                פרטי שיחה
              </DialogTitle>
              <DialogDescription>
                {selectedCall && format(new Date(selectedCall.created_at), 'EEEE, d MMMM yyyy בשעה HH:mm', { locale: he })}
              </DialogDescription>
            </DialogHeader>

            {selectedCall && (
              <div className="space-y-4">
                {/* Call Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {selectedCall.caller_name || 'לקוח אנונימי'}
                    </span>
                  </div>
                  {selectedCall.caller_phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm" dir="ltr">{selectedCall.caller_phone}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">
                      {formatDuration(selectedCall.duration_seconds)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="gap-1">
                      <span>{LANGUAGE_LABELS[selectedCall.language]?.flag || '🌐'}</span>
                      <span>{LANGUAGE_LABELS[selectedCall.language]?.label || selectedCall.language}</span>
                    </Badge>
                  </div>
                </div>

                {/* Summary */}
                {selectedCall.summary && (
                  <div className="p-4 rounded-xl bg-secondary/50">
                    <div className="flex items-center gap-2 mb-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium text-sm">סיכום השיחה</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedCall.summary}</p>
                  </div>
                )}

                {/* Transcript */}
                <div>
                  <h4 className="font-medium mb-3">תמלול השיחה</h4>
                  <ScrollArea className="h-64 rounded-xl border p-4">
                    {selectedCall.transcript.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        אין תמלול זמין לשיחה זו
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {selectedCall.transcript.map((msg, i) => (
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
                              <p>{msg.content}</p>
                              {msg.timestamp && (
                                <p className={`text-xs mt-1 ${
                                  msg.role === 'user' ? 'text-muted-foreground' : 'text-primary-foreground/70'
                                }`}>
                                  {msg.timestamp}
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}