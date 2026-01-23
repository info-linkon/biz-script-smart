import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Send, Clock, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';

interface SupportTicket {
  id: string;
  subject: string;
  message: string;
  status: string;
  priority: string;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
}

interface SupportTicketFormProps {
  tickets: SupportTicket[];
  onRefresh: () => void;
}

export function SupportTicketForm({ tickets, onRefresh }: SupportTicketFormProps) {
  const { user } = useAuth();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState('normal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !subject.trim() || !message.trim()) return;

    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          subject: subject.trim(),
          message: message.trim(),
          priority
        });

      if (error) throw error;

      toast.success('הפנייה נשלחה בהצלחה');
      setSubject('');
      setMessage('');
      setPriority('normal');
      setShowForm(false);
      onRefresh();
    } catch (error) {
      console.error('Error creating ticket:', error);
      toast.error('שגיאה בשליחת הפנייה');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> ממתין לתגובה</Badge>;
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">תמיכה</h2>
          <p className="text-muted-foreground">שלח פנייה לצוות התמיכה שלנו</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)}>
          <MessageSquare className="h-4 w-4 ml-2" />
          פנייה חדשה
        </Button>
      </div>

      {/* New Ticket Form */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>פנייה חדשה</CardTitle>
            <CardDescription>מלא את הפרטים ונחזור אליך בהקדם</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">נושא</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="תאר בקצרה את הבעיה"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">עדיפות</label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">נמוכה - שאלה כללית</SelectItem>
                    <SelectItem value="normal">רגילה - בעיה שאינה דחופה</SelectItem>
                    <SelectItem value="high">גבוהה - בעיה המשפיעה על העבודה</SelectItem>
                    <SelectItem value="urgent">דחוף - המערכת לא עובדת</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">תיאור הבעיה</label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="תאר את הבעיה בפירוט כדי שנוכל לעזור לך בצורה הטובה ביותר"
                  rows={5}
                  required
                />
              </div>

              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                  ביטול
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  <Send className="h-4 w-4 ml-2" />
                  {isSubmitting ? 'שולח...' : 'שלח פנייה'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tickets List */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">הפניות שלי ({tickets.length})</h3>
        
        {tickets.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>אין לך פניות פתוחות</p>
              <p className="text-sm">לחץ על "פנייה חדשה" כדי לפתוח פנייה</p>
            </CardContent>
          </Card>
        ) : (
          tickets.map((ticket) => (
            <Card key={ticket.id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg">{ticket.subject}</CardTitle>
                    <CardDescription>
                      נשלח ב-{format(new Date(ticket.created_at), 'dd/MM/yyyy HH:mm', { locale: he })}
                    </CardDescription>
                  </div>
                  {getStatusBadge(ticket.status)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3 bg-muted rounded-lg whitespace-pre-wrap">
                  {ticket.message}
                </div>

                {ticket.admin_response && (
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-primary">תגובת הצוות:</div>
                    <div className="p-3 bg-primary/10 rounded-lg whitespace-pre-wrap border border-primary/20">
                      {ticket.admin_response}
                      {ticket.responded_at && (
                        <div className="text-xs text-muted-foreground mt-2">
                          {format(new Date(ticket.responded_at), 'dd/MM/yyyy HH:mm', { locale: he })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
