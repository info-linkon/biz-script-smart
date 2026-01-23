import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Phone, 
  Search,
  Eye,
  Clock,
  User,
  MessageSquare
} from 'lucide-react';
import { Json } from '@/integrations/supabase/types';

interface Call {
  id: string;
  user_id: string;
  caller_name: string | null;
  caller_phone: string | null;
  status: string | null;
  duration_seconds: number | null;
  summary: string | null;
  transcript: Json | null;
  language: string | null;
  created_at: string;
  business_name?: string;
}

export function AdminCalls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedCall, setSelectedCall] = useState<Call | null>(null);
  const [showCallDialog, setShowCallDialog] = useState(false);

  useEffect(() => {
    fetchCalls();
  }, []);

  const fetchCalls = async () => {
    setLoading(true);
    
    // Fetch calls with profile info
    const { data: callsData, error } = await supabase
      .from('calls')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Error fetching calls:', error);
      setLoading(false);
      return;
    }

    // Get unique user IDs
    const userIds = [...new Set(callsData?.map(c => c.user_id) || [])];
    
    // Fetch profiles for these users
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, business_name')
      .in('user_id', userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p.business_name]) || []);

    const callsWithBusiness = (callsData || []).map(call => ({
      ...call,
      business_name: profileMap.get(call.user_id) || 'לא ידוע'
    }));

    setCalls(callsWithBusiness);
    setLoading(false);
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'completed':
        return <Badge variant="default">הושלמה</Badge>;
      case 'missed':
        return <Badge variant="destructive">נענתה</Badge>;
      case 'in_progress':
        return <Badge variant="secondary">בתהליך</Badge>;
      default:
        return <Badge variant="outline">{status || 'לא ידוע'}</Badge>;
    }
  };

  const filteredCalls = calls.filter(call => {
    const matchesSearch = 
      call.caller_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.caller_phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      call.business_name?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = 
      statusFilter === 'all' || call.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const renderTranscript = (transcript: Json | null) => {
    if (!transcript) return 'אין תמליל';
    
    if (Array.isArray(transcript)) {
      return transcript.map((item, index) => {
        const entry = item as { role?: string; message?: string; text?: string };
        return (
          <div key={index} className="py-2 border-b last:border-0">
            <span className="font-medium text-primary">
              {entry.role === 'agent' ? 'סוכן: ' : 'לקוח: '}
            </span>
            <span>{entry.message || entry.text}</span>
          </div>
        );
      });
    }
    
    return JSON.stringify(transcript, null, 2);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Phone className="h-5 w-5" />
                כל השיחות במערכת
              </CardTitle>
              <CardDescription>
                {calls.length} שיחות סה"כ
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש לפי שם, טלפון או עסק..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10 w-72"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="סינון לפי סטטוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  <SelectItem value="completed">הושלמו</SelectItem>
                  <SelectItem value="missed">לא נענו</SelectItem>
                  <SelectItem value="in_progress">בתהליך</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">עסק</TableHead>
                <TableHead className="text-right">מתקשר</TableHead>
                <TableHead className="text-right">טלפון</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">משך</TableHead>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCalls.slice(0, 100).map(call => (
                <TableRow key={call.id}>
                  <TableCell className="font-medium">{call.business_name}</TableCell>
                  <TableCell>{call.caller_name || 'לא ידוע'}</TableCell>
                  <TableCell dir="ltr" className="text-left">{call.caller_phone || '-'}</TableCell>
                  <TableCell>{getStatusBadge(call.status)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {formatDuration(call.duration_seconds)}
                    </div>
                  </TableCell>
                  <TableCell>
                    {new Date(call.created_at).toLocaleDateString('he-IL')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedCall(call);
                        setShowCallDialog(true);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredCalls.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו שיחות
            </div>
          )}

          {filteredCalls.length > 100 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              מציג 100 מתוך {filteredCalls.length} שיחות
            </div>
          )}
        </CardContent>
      </Card>

      {/* Call Details Dialog */}
      <Dialog open={showCallDialog} onOpenChange={setShowCallDialog}>
        <DialogContent dir="rtl" className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>פרטי שיחה</DialogTitle>
            <DialogDescription>
              {selectedCall && new Date(selectedCall.created_at).toLocaleString('he-IL')}
            </DialogDescription>
          </DialogHeader>
          
          {selectedCall && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <User className="h-4 w-4" />
                    עסק
                  </div>
                  <p className="font-medium">{selectedCall.business_name}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    מתקשר
                  </div>
                  <p className="font-medium">
                    {selectedCall.caller_name || 'לא ידוע'} - {selectedCall.caller_phone || '-'}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="h-4 w-4" />
                    משך
                  </div>
                  <p className="font-medium">{formatDuration(selectedCall.duration_seconds)}</p>
                </div>
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">סטטוס</div>
                  {getStatusBadge(selectedCall.status)}
                </div>
              </div>

              {selectedCall.summary && (
                <div className="space-y-2">
                  <h4 className="font-medium">סיכום</h4>
                  <p className="text-sm bg-muted p-3 rounded-lg">{selectedCall.summary}</p>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <MessageSquare className="h-4 w-4" />
                  תמליל שיחה
                </h4>
                <ScrollArea className="h-64 border rounded-lg p-4">
                  <div className="text-sm">
                    {renderTranscript(selectedCall.transcript)}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
