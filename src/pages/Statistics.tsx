import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { 
  Phone, 
  Clock, 
  TrendingUp, 
  TrendingDown,
  Minus,
  Languages, 
  Calendar,
  CheckCircle,
  Timer,
  Loader2,
  CalendarIcon,
  ArrowUpRight,
  ArrowDownRight,
  AlertTriangle,
  Bell,
  X
} from 'lucide-react';
import { format, subDays, differenceInDays, eachDayOfInterval } from 'date-fns';
import { he } from 'date-fns/locale';
import { DateRange } from 'react-day-picker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts';

const LANGUAGE_LABELS: Record<string, { label: string; flag: string; color: string }> = {
  he: { label: 'עברית', flag: '🇮🇱', color: 'hsl(var(--primary))' },
  ar: { label: 'ערבית', flag: '🇸🇦', color: 'hsl(var(--chart-2))' },
  en: { label: 'English', flag: '🇺🇸', color: 'hsl(var(--chart-3))' },
};

interface DailyCallData {
  date: string;
  displayDate: string;
  calls: number;
  avgDuration: number;
}

interface LanguageData {
  name: string;
  value: number;
  color: string;
  flag: string;
}

interface HourlyData {
  hour: string;
  calls: number;
}

interface Call {
  id: string;
  call_type: string;
  duration_seconds: number | null;
  status: string;
  language: string;
  created_at: string;
}

export default function Statistics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [calls, setCalls] = useState<Call[]>([]);
  const [dailyData, setDailyData] = useState<DailyCallData[]>([]);
  const [languageData, setLanguageData] = useState<LanguageData[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: subDays(new Date(), 30),
    to: new Date(),
  });
  const [stats, setStats] = useState({
    totalCalls: 0,
    completedCalls: 0,
    avgDuration: 0,
    totalDuration: 0,
    successRate: 0,
    busiestHour: '',
  });
  const [previousStats, setPreviousStats] = useState({
    totalCalls: 0,
    completedCalls: 0,
    avgDuration: 0,
    totalDuration: 0,
    successRate: 0,
  });
  const [dismissedAlerts, setDismissedAlerts] = useState<string[]>([]);

  useEffect(() => {
    if (user && dateRange?.from && dateRange?.to) {
      fetchStatistics();
    }
  }, [user, dateRange]);

  const fetchStatistics = async () => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    try {
      setLoading(true);
      
      // Calculate the previous period
      const rangeDays = differenceInDays(dateRange.to, dateRange.from) + 1;
      const previousFrom = subDays(dateRange.from, rangeDays);
      const previousTo = subDays(dateRange.from, 1);
      
      // Fetch current period data
      const { data: currentData, error: currentError } = await supabase
        .from('calls')
        .select('*')
        .gte('created_at', dateRange.from.toISOString())
        .lte('created_at', dateRange.to.toISOString())
        .order('created_at', { ascending: true });

      if (currentError) throw currentError;
      
      // Fetch previous period data for comparison
      const { data: previousData, error: previousError } = await supabase
        .from('calls')
        .select('*')
        .gte('created_at', previousFrom.toISOString())
        .lte('created_at', previousTo.toISOString());

      if (previousError) throw previousError;
      
      const callsData = currentData || [];
      const prevCallsData = previousData || [];
      
      setCalls(callsData);
      
      processStatistics(callsData);
      processPreviousStatistics(prevCallsData);
    } catch (error) {
      console.error('Error fetching statistics:', error);
      toast.error('שגיאה בטעינת הסטטיסטיקות');
    } finally {
      setLoading(false);
    }
  };

  const processPreviousStatistics = (callsData: Call[]) => {
    const totalCalls = callsData.length;
    const completedCalls = callsData.filter(c => c.status === 'completed').length;
    const totalDuration = callsData.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

    setPreviousStats({
      totalCalls,
      completedCalls,
      avgDuration,
      totalDuration,
      successRate,
    });
  };

  const processStatistics = (callsData: Call[]) => {
    if (!dateRange?.from || !dateRange?.to) return;
    
    // Basic stats
    const totalCalls = callsData.length;
    const completedCalls = callsData.filter(c => c.status === 'completed').length;
    const totalDuration = callsData.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

    // Daily data for line chart based on selected range
    const dailyMap = new Map<string, { calls: number; totalDuration: number }>();
    const days = eachDayOfInterval({ start: dateRange.from, end: dateRange.to });
    
    days.forEach(day => {
      const date = format(day, 'yyyy-MM-dd');
      dailyMap.set(date, { calls: 0, totalDuration: 0 });
    });
    
    callsData.forEach(call => {
      const date = format(new Date(call.created_at), 'yyyy-MM-dd');
      if (dailyMap.has(date)) {
        const current = dailyMap.get(date)!;
        current.calls++;
        current.totalDuration += call.duration_seconds || 0;
      }
    });

    const daily: DailyCallData[] = Array.from(dailyMap.entries()).map(([date, data]) => ({
      date,
      displayDate: format(new Date(date), 'dd/MM', { locale: he }),
      calls: data.calls,
      avgDuration: data.calls > 0 ? Math.round(data.totalDuration / data.calls) : 0,
    }));

    // Language distribution
    const langMap = new Map<string, number>();
    callsData.forEach(call => {
      const lang = call.language || 'he';
      langMap.set(lang, (langMap.get(lang) || 0) + 1);
    });

    const languages: LanguageData[] = Array.from(langMap.entries()).map(([lang, count]) => ({
      name: LANGUAGE_LABELS[lang]?.label || lang,
      value: count,
      color: LANGUAGE_LABELS[lang]?.color || 'hsl(var(--muted))',
      flag: LANGUAGE_LABELS[lang]?.flag || '🌐',
    }));

    // Hourly distribution
    const hourMap = new Map<number, number>();
    for (let i = 0; i < 24; i++) {
      hourMap.set(i, 0);
    }
    
    callsData.forEach(call => {
      const hour = new Date(call.created_at).getHours();
      hourMap.set(hour, (hourMap.get(hour) || 0) + 1);
    });

    const hourly: HourlyData[] = Array.from(hourMap.entries()).map(([hour, count]) => ({
      hour: `${hour.toString().padStart(2, '0')}:00`,
      calls: count,
    }));

    // Find busiest hour
    let busiestHour = '';
    let maxCalls = 0;
    hourMap.forEach((count, hour) => {
      if (count > maxCalls) {
        maxCalls = count;
        busiestHour = `${hour.toString().padStart(2, '0')}:00`;
      }
    });

    setDailyData(daily);
    setLanguageData(languages);
    setHourlyData(hourly);
    setStats({
      totalCalls,
      completedCalls,
      avgDuration,
      totalDuration,
      successRate,
      busiestHour,
    });
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTotalDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours} שעות ${mins} דקות`;
    }
    return `${mins} דקות`;
  };

  const calculateChange = (current: number, previous: number): { value: number; isPositive: boolean; isZero: boolean } => {
    if (previous === 0) {
      return { value: current > 0 ? 100 : 0, isPositive: current > 0, isZero: current === 0 };
    }
    const change = Math.round(((current - previous) / previous) * 100);
    return { value: Math.abs(change), isPositive: change > 0, isZero: change === 0 };
  };

  const ChangeIndicator = ({ current, previous, invertColors = false }: { current: number; previous: number; invertColors?: boolean }) => {
    const change = calculateChange(current, previous);
    
    if (change.isZero) {
      return (
        <div className="flex items-center gap-1 text-muted-foreground text-xs">
          <Minus className="h-3 w-3" />
          <span>ללא שינוי</span>
        </div>
      );
    }
    
    const isGood = invertColors ? !change.isPositive : change.isPositive;
    
    return (
      <div className={cn(
        "flex items-center gap-1 text-xs",
        isGood ? "text-green-600" : "text-red-600"
      )}>
        {change.isPositive ? (
          <ArrowUpRight className="h-3 w-3" />
        ) : (
          <ArrowDownRight className="h-3 w-3" />
        )}
        <span>{change.value}%</span>
      </div>
    );
  };

  // Generate performance alerts
  interface PerformanceAlert {
    id: string;
    type: 'warning' | 'critical';
    title: string;
    description: string;
    metric: string;
    change: number;
  }

  const generateAlerts = (): PerformanceAlert[] => {
    const alerts: PerformanceAlert[] = [];
    const THRESHOLD_WARNING = 20; // 20% drop
    const THRESHOLD_CRITICAL = 50; // 50% drop

    // Check total calls
    if (previousStats.totalCalls > 0) {
      const callsChange = ((stats.totalCalls - previousStats.totalCalls) / previousStats.totalCalls) * 100;
      if (callsChange <= -THRESHOLD_CRITICAL) {
        alerts.push({
          id: 'calls-critical',
          type: 'critical',
          title: 'ירידה קריטית בכמות השיחות',
          description: `כמות השיחות ירדה ב-${Math.abs(Math.round(callsChange))}% לעומת התקופה הקודמת`,
          metric: 'calls',
          change: callsChange,
        });
      } else if (callsChange <= -THRESHOLD_WARNING) {
        alerts.push({
          id: 'calls-warning',
          type: 'warning',
          title: 'ירידה בכמות השיחות',
          description: `כמות השיחות ירדה ב-${Math.abs(Math.round(callsChange))}% לעומת התקופה הקודמת`,
          metric: 'calls',
          change: callsChange,
        });
      }
    }

    // Check success rate
    if (previousStats.successRate > 0) {
      const successChange = stats.successRate - previousStats.successRate;
      if (successChange <= -THRESHOLD_CRITICAL / 2) { // More sensitive for success rate
        alerts.push({
          id: 'success-critical',
          type: 'critical',
          title: 'ירידה קריטית באחוז ההצלחה',
          description: `אחוז ההצלחה ירד מ-${previousStats.successRate}% ל-${stats.successRate}%`,
          metric: 'successRate',
          change: successChange,
        });
      } else if (successChange <= -THRESHOLD_WARNING / 2) {
        alerts.push({
          id: 'success-warning',
          type: 'warning',
          title: 'ירידה באחוז ההצלחה',
          description: `אחוז ההצלחה ירד מ-${previousStats.successRate}% ל-${stats.successRate}%`,
          metric: 'successRate',
          change: successChange,
        });
      }
    }

    // Check completed calls
    if (previousStats.completedCalls > 0) {
      const completedChange = ((stats.completedCalls - previousStats.completedCalls) / previousStats.completedCalls) * 100;
      if (completedChange <= -THRESHOLD_CRITICAL) {
        alerts.push({
          id: 'completed-critical',
          type: 'critical',
          title: 'ירידה קריטית בשיחות שהושלמו',
          description: `מספר השיחות שהושלמו ירד ב-${Math.abs(Math.round(completedChange))}%`,
          metric: 'completed',
          change: completedChange,
        });
      } else if (completedChange <= -THRESHOLD_WARNING) {
        alerts.push({
          id: 'completed-warning',
          type: 'warning',
          title: 'ירידה בשיחות שהושלמו',
          description: `מספר השיחות שהושלמו ירד ב-${Math.abs(Math.round(completedChange))}%`,
          metric: 'completed',
          change: completedChange,
        });
      }
    }

    // Check average duration (significant increase might indicate issues)
    if (previousStats.avgDuration > 0) {
      const durationChange = ((stats.avgDuration - previousStats.avgDuration) / previousStats.avgDuration) * 100;
      if (durationChange >= THRESHOLD_CRITICAL) {
        alerts.push({
          id: 'duration-warning',
          type: 'warning',
          title: 'עלייה משמעותית בזמן שיחה ממוצע',
          description: `זמן השיחה הממוצע עלה ב-${Math.round(durationChange)}% - ייתכן שיש בעיות בתהליך`,
          metric: 'duration',
          change: durationChange,
        });
      }
    }

    return alerts;
  };

  const alerts = generateAlerts().filter(alert => !dismissedAlerts.includes(alert.id));

  const dismissAlert = (alertId: string) => {
    setDismissedAlerts(prev => [...prev, alertId]);
  };

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  const getDateRangeLabel = () => {
    if (!dateRange?.from || !dateRange?.to) return 'בחר טווח תאריכים';
    const days = differenceInDays(dateRange.to, dateRange.from) + 1;
    return `${days} ימים`;
  };

  const handlePresetRange = (days: number) => {
    setDateRange({
      from: subDays(new Date(), days - 1),
      to: new Date(),
    });
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">סטטיסטיקות מתקדמות</h1>
            <p className="text-muted-foreground">
              {dateRange?.from && dateRange?.to 
                ? `${format(dateRange.from, 'dd/MM/yyyy', { locale: he })} - ${format(dateRange.to, 'dd/MM/yyyy', { locale: he })}`
                : 'בחר טווח תאריכים'
              }
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Preset buttons */}
            <div className="hidden sm:flex items-center gap-1">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => handlePresetRange(7)}
                className={cn(
                  dateRange?.from && differenceInDays(new Date(), dateRange.from) === 6 && 'bg-primary text-primary-foreground'
                )}
              >
                7 ימים
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => handlePresetRange(30)}
                className={cn(
                  dateRange?.from && differenceInDays(new Date(), dateRange.from) === 29 && 'bg-primary text-primary-foreground'
                )}
              >
                30 יום
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => handlePresetRange(90)}
                className={cn(
                  dateRange?.from && differenceInDays(new Date(), dateRange.from) === 89 && 'bg-primary text-primary-foreground'
                )}
              >
                90 יום
              </Button>
            </div>
            
            {/* Date range picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "justify-start text-right font-normal",
                    !dateRange && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="ml-2 h-4 w-4" />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "dd/MM", { locale: he })} -{" "}
                        {format(dateRange.to, "dd/MM", { locale: he })}
                      </>
                    ) : (
                      format(dateRange.from, "dd/MM/yyyy", { locale: he })
                    )
                  ) : (
                    <span>בחר טווח</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange?.from}
                  selected={dateRange}
                  onSelect={setDateRange}
                  numberOfMonths={2}
                  locale={he}
                  className={cn("p-3 pointer-events-auto")}
                  disabled={(date) => date > new Date()}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Performance Alerts */}
        {alerts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-orange-500" />
              <h2 className="font-semibold">התראות ביצועים</h2>
              <span className="text-xs bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full">
                {alerts.length} התראות
              </span>
            </div>
            {alerts.map((alert) => (
              <Alert 
                key={alert.id} 
                variant={alert.type === 'critical' ? 'destructive' : 'default'}
                className={cn(
                  "relative",
                  alert.type === 'warning' && "border-orange-500/50 bg-orange-500/5"
                )}
              >
                <AlertTriangle className={cn(
                  "h-4 w-4",
                  alert.type === 'critical' ? "text-destructive" : "text-orange-500"
                )} />
                <AlertTitle className="flex items-center justify-between">
                  <span>{alert.title}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 absolute top-2 left-2"
                    onClick={() => dismissAlert(alert.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </AlertTitle>
                <AlertDescription>
                  {alert.description}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        <Card className="border-0 shadow-sm bg-secondary/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <span>
                השוואה לתקופה הקודמת: {dateRange?.from && dateRange?.to && (
                  <>
                    {format(subDays(dateRange.from, differenceInDays(dateRange.to, dateRange.from) + 1), 'dd/MM', { locale: he })} - {format(subDays(dateRange.from, 1), 'dd/MM', { locale: he })}
                  </>
                )}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold">{stats.totalCalls}</p>
                    <ChangeIndicator current={stats.totalCalls} previous={previousStats.totalCalls} />
                  </div>
                  <p className="text-sm text-muted-foreground">סה"כ שיחות</p>
                  <p className="text-xs text-muted-foreground">לעומת {previousStats.totalCalls} קודם</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-green-500/10 flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold">{stats.completedCalls}</p>
                    <ChangeIndicator current={stats.completedCalls} previous={previousStats.completedCalls} />
                  </div>
                  <p className="text-sm text-muted-foreground">הושלמו</p>
                  <p className="text-xs text-muted-foreground">לעומת {previousStats.completedCalls} קודם</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold">{stats.successRate}%</p>
                    <ChangeIndicator current={stats.successRate} previous={previousStats.successRate} />
                  </div>
                  <p className="text-sm text-muted-foreground">אחוז הצלחה</p>
                  <p className="text-xs text-muted-foreground">לעומת {previousStats.successRate}% קודם</p>
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
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold">{formatDuration(stats.avgDuration)}</p>
                    <ChangeIndicator current={stats.avgDuration} previous={previousStats.avgDuration} />
                  </div>
                  <p className="text-sm text-muted-foreground">זמן ממוצע</p>
                  <p className="text-xs text-muted-foreground">לעומת {formatDuration(previousStats.avgDuration)} קודם</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Timer className="h-5 w-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-lg font-bold">{formatTotalDuration(stats.totalDuration)}</p>
                    <ChangeIndicator current={stats.totalDuration} previous={previousStats.totalDuration} />
                  </div>
                  <p className="text-sm text-muted-foreground">זמן כולל</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-pink-500/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-pink-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.busiestHour || '--'}</p>
                  <p className="text-sm text-muted-foreground">שעת שיא</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 1 */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Calls Over Time */}
          <Card className="border-0 shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">שיחות לאורך זמן</CardTitle>
              <CardDescription>{getDateRangeLabel()}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="displayDate" 
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        direction: 'rtl'
                      }}
                      labelFormatter={(label) => `תאריך: ${label}`}
                      formatter={(value: number) => [`${value} שיחות`, 'מספר שיחות']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="calls" 
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Language Distribution */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Languages className="h-5 w-5" />
                התפלגות שפות
              </CardTitle>
              <CardDescription>לפי מספר שיחות</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={languageData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {languageData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        direction: 'rtl'
                      }}
                      formatter={(value: number, name: string) => [`${value} שיחות`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-4">
                {languageData.map((lang, index) => (
                  <div key={index} className="flex items-center gap-2 text-sm">
                    <span>{lang.flag}</span>
                    <span className="text-muted-foreground">{lang.name}</span>
                    <span className="font-bold">{lang.value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row 2 */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Hourly Distribution */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">התפלגות לפי שעות</CardTitle>
              <CardDescription>מתי הלקוחות מתקשרים</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="hour" 
                      tick={{ fontSize: 10 }}
                      interval={2}
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        direction: 'rtl'
                      }}
                      labelFormatter={(label) => `שעה: ${label}`}
                      formatter={(value: number) => [`${value} שיחות`, 'מספר שיחות']}
                    />
                    <Bar 
                      dataKey="calls" 
                      fill="hsl(var(--primary))" 
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Average Duration Over Time */}
          <Card className="border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">זמן שיחה ממוצע</CardTitle>
              <CardDescription>משך שיחה ממוצע לאורך זמן (בשניות)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="displayDate" 
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                      className="text-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="text-muted-foreground"
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        direction: 'rtl'
                      }}
                      labelFormatter={(label) => `תאריך: ${label}`}
                      formatter={(value: number) => [`${formatDuration(value)}`, 'זמן ממוצע']}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="avgDuration" 
                      stroke="hsl(var(--chart-2))" 
                      strokeWidth={2}
                      dot={{ fill: 'hsl(var(--chart-2))', strokeWidth: 2 }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
