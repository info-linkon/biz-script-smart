import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Search, MessageSquare, Clock, AlertCircle, CheckCircle, XCircle, Send } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

interface SupportTicket {
  id: string;
  user_id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  admin_response: string | null;
  responded_at: string | null;
  responded_by: string | null;
  created_at: string;
  updated_at: string;
  user_email?: string;
  user_business?: string;
}

interface AdminSupportProps {
  tickets: SupportTicket[];
  onRefresh: () => void;
}

export function AdminSupport({ tickets, onRefresh }: AdminSupportProps) {
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [response, setResponse] = useState('');
  const [newStatus, setNewStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredTickets = tickets.filter(ticket => {
    const matchesSearch = 
      ticket.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ticket.user_email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || ticket.status === statusFilter;
    const matchesPriority = priorityFilter === 'all' || ticket.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> פתוח</Badge>;
      case 'in_progress':
        return <Badge variant="secondary" className="gap-1 bg-yellow-500/20 text-yellow-700"><Clock className="h-3 w-3" /> בטיפול</Badge>;
      case 'resolved':
        return <Badge variant="secondary" className="gap-1 bg-green-500/20 text-green-700"><CheckCircle className="h-3 w-3" /> נפתר</Badge>;
      case 'closed':
        return <Badge variant="outline" className="gap-1"><XCircle className="h-3 w-3" /> סגור</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'urgent':
        return <Badge variant="destructive">דחוף</Badge>;
      case 'high':
        return <Badge className="bg-orange-500">גבוהה</Badge>;
      case 'normal':
        return <Badge variant="secondary">רגילה</Badge>;
      case 'low':
        return <Badge variant="outline">נמוכה</Badge>;
      default:
        return <Badge>{priority}</Badge>;
    }
  };

  const handleOpenTicket = (ticket: SupportTicket) => {
    setSelectedTicket(ticket);
    setResponse(ticket.admin_response || '');
    setNewStatus(ticket.status);
  };

  const handleSubmitResponse = async () => {
    if (!selectedTicket || !user) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .update({
          admin_response: response,
          status: newStatus,
          responded_at: new Date().toISOString(),
          responded_by: user.id
        })
        .eq('id', selectedTicket.id);

      if (error) throw error;

      toast.success('התגובה נשלחה בהצלחה');
      setSelectedTicket(null);
      onRefresh();
    } catch (error) {
      console.error('Error updating ticket:', error);
      toast.error('שגיאה בעדכון הפנייה');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openTickets = tickets.filter(t => t.status === 'open').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const urgentTickets = tickets.filter(t => t.priority === 'urgent' && t.status !== 'closed').length;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">סה"כ פניות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets.length}</div>
          </CardContent>
        </Card>
        <Card className="border-red-200 bg-red-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-700">פניות פתוחות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-700">{openTickets}</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-200 bg-yellow-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-yellow-700">בטיפול</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-700">{inProgressTickets}</div>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-700">דחופות</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">{urgentTickets}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="חיפוש לפי נושא, תוכן או אימייל..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="סטטוס" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל הסטטוסים</SelectItem>
                <SelectItem value="open">פתוח</SelectItem>
                <SelectItem value="in_progress">בטיפול</SelectItem>
                <SelectItem value="resolved">נפתר</SelectItem>
                <SelectItem value="closed">סגור</SelectItem>
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-full md:w-40">
                <SelectValue placeholder="עדיפות" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל העדיפויות</SelectItem>
                <SelectItem value="urgent">דחוף</SelectItem>
                <SelectItem value="high">גבוהה</SelectItem>
                <SelectItem value="normal">רגילה</SelectItem>
                <SelectItem value="low">נמוכה</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Tickets Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            פניות תמיכה ({filteredTickets.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredTickets.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>לא נמצאו פניות</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">נושא</TableHead>
                  <TableHead className="text-right">משתמש</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">עדיפות</TableHead>
                  <TableHead className="text-right">תאריך</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((ticket) => (
                  <TableRow key={ticket.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {ticket.subject}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <div>{ticket.user_email || 'לא ידוע'}</div>
                        {ticket.user_business && (
                          <div className="text-muted-foreground text-xs">{ticket.user_business}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(ticket.status)}</TableCell>
                    <TableCell>{getPriorityBadge(ticket.priority)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(ticket.created_at), 'dd/MM/yyyy HH:mm', { locale: he })}
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => handleOpenTicket(ticket)}
                      >
                        צפייה
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Ticket Detail Dialog */}
      <Dialog open={!!selectedTicket} onOpenChange={() => setSelectedTicket(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              פרטי פנייה
            </DialogTitle>
          </DialogHeader>
          
          {selectedTicket && (
            <div className="space-y-6">
              {/* Ticket Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">סטטוס</label>
                  <div className="mt-1">{getStatusBadge(selectedTicket.status)}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">עדיפות</label>
                  <div className="mt-1">{getPriorityBadge(selectedTicket.priority)}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">משתמש</label>
                  <div className="mt-1">{selectedTicket.user_email || 'לא ידוע'}</div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">תאריך יצירה</label>
                  <div className="mt-1">
                    {format(new Date(selectedTicket.created_at), 'dd/MM/yyyy HH:mm', { locale: he })}
                  </div>
                </div>
              </div>

              {/* Subject & Message */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">נושא</label>
                <div className="p-3 bg-muted rounded-lg font-medium">{selectedTicket.subject}</div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">תוכן הפנייה</label>
                <div className="p-3 bg-muted rounded-lg whitespace-pre-wrap">{selectedTicket.message}</div>
              </div>

              {/* Previous Response */}
              {selectedTicket.admin_response && (
                <div className="space-y-2">
                  <label className="text-sm font-medium text-muted-foreground">תגובה קודמת</label>
                  <div className="p-3 bg-primary/10 rounded-lg whitespace-pre-wrap border border-primary/20">
                    {selectedTicket.admin_response}
                    {selectedTicket.responded_at && (
                      <div className="text-xs text-muted-foreground mt-2">
                        נשלח ב-{format(new Date(selectedTicket.responded_at), 'dd/MM/yyyy HH:mm', { locale: he })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Response Form */}
              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">עדכון סטטוס</label>
                  <Select value={newStatus} onValueChange={setNewStatus}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">פתוח</SelectItem>
                      <SelectItem value="in_progress">בטיפול</SelectItem>
                      <SelectItem value="resolved">נפתר</SelectItem>
                      <SelectItem value="closed">סגור</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">תגובה</label>
                  <Textarea
                    value={response}
                    onChange={(e) => setResponse(e.target.value)}
                    placeholder="כתוב תגובה ללקוח..."
                    rows={4}
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTicket(null)}>
              ביטול
            </Button>
            <Button onClick={handleSubmitResponse} disabled={isSubmitting}>
              <Send className="h-4 w-4 ml-2" />
              {isSubmitting ? 'שולח...' : 'שלח תגובה'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
