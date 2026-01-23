import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Calendar, 
  Search,
  Clock,
  User,
  CheckCircle,
  XCircle,
  AlertCircle
} from 'lucide-react';

interface Appointment {
  id: string;
  user_id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  status: string | null;
  created_at: string;
  business_name?: string;
}

export function AdminAppointments() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  useEffect(() => {
    fetchAppointments();
  }, []);

  const fetchAppointments = async () => {
    setLoading(true);
    
    const { data: appointmentsData, error } = await supabase
      .from('appointments')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Error fetching appointments:', error);
      setLoading(false);
      return;
    }

    // Get unique user IDs
    const userIds = [...new Set(appointmentsData?.map(a => a.user_id) || [])];
    
    // Fetch profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, business_name')
      .in('user_id', userIds);

    const profileMap = new Map(profiles?.map(p => [p.user_id, p.business_name]) || []);

    const appointmentsWithBusiness = (appointmentsData || []).map(apt => ({
      ...apt,
      business_name: profileMap.get(apt.user_id) || 'לא ידוע'
    }));

    setAppointments(appointmentsWithBusiness);
    setLoading(false);
  };

  const handleUpdateStatus = async (id: string, status: string) => {
    const { error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', id);

    if (error) {
      toast.error('שגיאה בעדכון הסטטוס');
    } else {
      toast.success('הסטטוס עודכן בהצלחה');
      fetchAppointments();
    }
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-success text-success-foreground">מאושר</Badge>;
      case 'cancelled':
        return <Badge variant="destructive">בוטל</Badge>;
      case 'completed':
        return <Badge variant="default">הושלם</Badge>;
      case 'pending':
      default:
        return <Badge variant="secondary">ממתין</Badge>;
    }
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return {
      date: date.toLocaleDateString('he-IL'),
      time: date.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
    };
  };

  const filteredAppointments = appointments.filter(apt => {
    const matchesSearch = 
      apt.customer_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      apt.customer_phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      apt.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      apt.title?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = 
      statusFilter === 'all' || apt.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

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
                <Calendar className="h-5 w-5" />
                כל הפגישות במערכת
              </CardTitle>
              <CardDescription>
                {appointments.length} פגישות סה"כ
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
                  <SelectItem value="pending">ממתין</SelectItem>
                  <SelectItem value="confirmed">מאושר</SelectItem>
                  <SelectItem value="completed">הושלם</SelectItem>
                  <SelectItem value="cancelled">בוטל</SelectItem>
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
                <TableHead className="text-right">כותרת</TableHead>
                <TableHead className="text-right">לקוח</TableHead>
                <TableHead className="text-right">תאריך</TableHead>
                <TableHead className="text-right">שעה</TableHead>
                <TableHead className="text-right">סטטוס</TableHead>
                <TableHead className="text-right">פעולות</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAppointments.slice(0, 100).map(apt => {
                const { date, time } = formatDateTime(apt.start_time);
                return (
                  <TableRow key={apt.id}>
                    <TableCell className="font-medium">{apt.business_name}</TableCell>
                    <TableCell>{apt.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {apt.customer_name}
                      </div>
                    </TableCell>
                    <TableCell>{date}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        {time}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(apt.status)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleUpdateStatus(apt.id, 'confirmed')}
                          title="אשר"
                          disabled={apt.status === 'confirmed'}
                        >
                          <CheckCircle className="h-4 w-4 text-success" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleUpdateStatus(apt.id, 'cancelled')}
                          title="בטל"
                          disabled={apt.status === 'cancelled'}
                        >
                          <XCircle className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          {filteredAppointments.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו פגישות
            </div>
          )}

          {filteredAppointments.length > 100 && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              מציג 100 מתוך {filteredAppointments.length} פגישות
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
