import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Calendar as CalendarIcon, Clock, User, Phone, Mail, Trash2, Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import { format, startOfWeek, addDays, isSameDay, addWeeks, subWeeks, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isToday } from 'date-fns';
import { he } from 'date-fns/locale';

interface Appointment {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  status: string;
  created_at: string;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [saving, setSaving] = useState(false);

  // Form state
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  useEffect(() => {
    if (user) {
      fetchAppointments();
    }
  }, [user]);

  const fetchAppointments = async () => {
    try {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .order('start_time', { ascending: true });

      if (error) throw error;
      setAppointments(data || []);
    } catch (error) {
      console.error('Error fetching appointments:', error);
      toast.error('שגיאה בטעינת הפגישות');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setTitle('');
    setDescription('');
    setDate('');
    setStartTime('');
    setEndTime('');
  };

  const handleSubmit = async () => {
    if (!customerName.trim() || !title.trim() || !date || !startTime || !endTime) {
      toast.error('נא למלא את כל השדות הנדרשים');
      return;
    }

    setSaving(true);

    try {
      const startDateTime = new Date(`${date}T${startTime}`);
      const endDateTime = new Date(`${date}T${endTime}`);

      const { error } = await supabase
        .from('appointments')
        .insert({
          user_id: user!.id,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim() || null,
          customer_email: customerEmail.trim() || null,
          title: title.trim(),
          description: description.trim() || null,
          start_time: startDateTime.toISOString(),
          end_time: endDateTime.toISOString(),
        });

      if (error) throw error;
      
      toast.success('הפגישה נוספה בהצלחה');
      setDialogOpen(false);
      resetForm();
      fetchAppointments();
    } catch (error) {
      console.error('Error creating appointment:', error);
      toast.error('שגיאה ביצירת הפגישה');
    } finally {
      setSaving(false);
    }
  };

  const deleteAppointment = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק את הפגישה?')) return;

    try {
      const { error } = await supabase
        .from('appointments')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast.success('הפגישה נמחקה בהצלחה');
      fetchAppointments();
    } catch (error) {
      console.error('Error deleting appointment:', error);
      toast.error('שגיאה במחיקת הפגישה');
    }
  };

  const getAppointmentsForDate = (date: Date) => {
    return appointments.filter(apt => 
      isSameDay(new Date(apt.start_time), date)
    );
  };

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const start = startOfWeek(selectedDate, { weekStartsOn: 0 });
    return addDays(start, i);
  });

  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }),
    end: addDays(startOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 }), 6),
  });

  const dayNames = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled': return 'bg-primary';
      case 'completed': return 'bg-green-500';
      case 'cancelled': return 'bg-destructive';
      default: return 'bg-muted';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">יומן פגישות</h1>
            <p className="text-muted-foreground">ניהול פגישות והזמנות</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border bg-card p-1">
              <Button
                variant={viewMode === 'week' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('week')}
              >
                שבוע
              </Button>
              <Button
                variant={viewMode === 'month' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('month')}
              >
                חודש
              </Button>
            </div>
            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button className="gradient-primary text-white">
                  <Plus className="ml-2 h-4 w-4" />
                  פגישה חדשה
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md" dir="rtl">
                <DialogHeader>
                  <DialogTitle>פגישה חדשה</DialogTitle>
                  <DialogDescription>
                    הוסף פגישה חדשה ליומן
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="customer">שם הלקוח *</Label>
                    <Input
                      id="customer"
                      placeholder="שם הלקוח"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="phone">טלפון</Label>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="050-0000000"
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">אימייל</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="email@example.com"
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">נושא הפגישה *</Label>
                    <Input
                      id="title"
                      placeholder="למשל: פגישת ייעוץ"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="date">תאריך *</Label>
                    <Input
                      id="date"
                      type="date"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      dir="ltr"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="start">שעת התחלה *</Label>
                      <Input
                        id="start"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="end">שעת סיום *</Label>
                      <Input
                        id="end"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        dir="ltr"
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)}>
                    ביטול
                  </Button>
                  <Button onClick={handleSubmit} disabled={saving} className="gradient-primary text-white">
                    {saving ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        שומר...
                      </>
                    ) : (
                      'הוסף פגישה'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Calendar Navigation */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="icon"
            onClick={() => viewMode === 'week' 
              ? setSelectedDate(subWeeks(selectedDate, 1))
              : setCurrentMonth(subWeeks(currentMonth, 4))
            }
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">
            {viewMode === 'week'
              ? `${format(weekDays[0], 'd MMM', { locale: he })} - ${format(weekDays[6], 'd MMM yyyy', { locale: he })}`
              : format(currentMonth, 'MMMM yyyy', { locale: he })
            }
          </h2>
          <Button
            variant="outline"
            size="icon"
            onClick={() => viewMode === 'week'
              ? setSelectedDate(addWeeks(selectedDate, 1))
              : setCurrentMonth(addWeeks(currentMonth, 4))
            }
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : viewMode === 'week' ? (
          /* Week View */
          <div className="grid grid-cols-7 gap-2">
            {weekDays.map((day, i) => {
              const dayAppointments = getAppointmentsForDate(day);
              const isCurrentDay = isToday(day);
              
              return (
                <Card 
                  key={i} 
                  className={`min-h-[200px] border-0 shadow-sm ${isCurrentDay ? 'ring-2 ring-primary' : ''}`}
                >
                  <CardHeader className="p-3 pb-2">
                    <div className="text-center">
                      <p className="text-xs text-muted-foreground">{dayNames[i]}</p>
                      <p className={`text-lg font-bold ${isCurrentDay ? 'text-primary' : ''}`}>
                        {format(day, 'd')}
                      </p>
                    </div>
                  </CardHeader>
                  <CardContent className="p-2 space-y-1">
                    {dayAppointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="p-2 rounded-lg bg-primary/10 text-xs cursor-pointer hover:bg-primary/20 transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium truncate">{apt.title}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => deleteAppointment(apt.id)}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                        <p className="text-muted-foreground">
                          {format(new Date(apt.start_time), 'HH:mm')}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          /* Month View */
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="grid grid-cols-7 gap-1">
                {dayNames.map((name) => (
                  <div key={name} className="text-center text-sm font-medium text-muted-foreground py-2">
                    {name}
                  </div>
                ))}
                {monthDays.map((day, i) => {
                  const dayAppointments = getAppointmentsForDate(day);
                  const isCurrentMonth = isSameMonth(day, currentMonth);
                  const isCurrentDay = isToday(day);
                  
                  return (
                    <div
                      key={i}
                      className={`min-h-[80px] p-1 rounded-lg border transition-colors ${
                        isCurrentDay ? 'border-primary bg-primary/5' : 'border-transparent hover:bg-secondary'
                      } ${!isCurrentMonth ? 'opacity-30' : ''}`}
                    >
                      <p className={`text-sm text-center ${isCurrentDay ? 'font-bold text-primary' : ''}`}>
                        {format(day, 'd')}
                      </p>
                      <div className="space-y-1 mt-1">
                        {dayAppointments.slice(0, 2).map((apt) => (
                          <div
                            key={apt.id}
                            className={`h-1.5 rounded-full ${getStatusColor(apt.status)}`}
                            title={apt.title}
                          />
                        ))}
                        {dayAppointments.length > 2 && (
                          <p className="text-xs text-center text-muted-foreground">
                            +{dayAppointments.length - 2}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Upcoming Appointments List */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">פגישות קרובות</CardTitle>
            <CardDescription>רשימת הפגישות הבאות שלך</CardDescription>
          </CardHeader>
          <CardContent>
            {appointments.filter(apt => new Date(apt.start_time) >= new Date()).length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <CalendarIcon className="h-12 w-12 mx-auto mb-2 opacity-20" />
                <p>אין פגישות קרובות</p>
              </div>
            ) : (
              <div className="space-y-3">
                {appointments
                  .filter(apt => new Date(apt.start_time) >= new Date())
                  .slice(0, 10)
                  .map((apt) => (
                    <div
                      key={apt.id}
                      className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors"
                    >
                      <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Clock className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium truncate">{apt.title}</h3>
                          <Badge variant="outline" className="text-xs">
                            {apt.status === 'scheduled' ? 'מתוכנן' : apt.status === 'completed' ? 'הושלם' : 'בוטל'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {apt.customer_name}
                          </span>
                          {apt.customer_phone && (
                            <span className="flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {apt.customer_phone}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-left">
                        <p className="font-medium">
                          {format(new Date(apt.start_time), 'HH:mm')}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(apt.start_time), 'dd/MM/yyyy')}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteAppointment(apt.id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}