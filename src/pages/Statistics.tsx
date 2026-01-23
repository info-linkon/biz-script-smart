import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { 
  Phone, 
  Clock, 
  TrendingUp, 
  Languages, 
  Calendar,
  CheckCircle,
  XCircle,
  Timer,
  Loader2
} from 'lucide-react';
import { format, subDays, startOfDay, endOfDay } from 'date-fns';
import { he } from 'date-fns/locale';
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
  Legend
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
  const [stats, setStats] = useState({
    totalCalls: 0,
    completedCalls: 0,
    avgDuration: 0,
    totalDuration: 0,
    successRate: 0,
    busiestHour: '',
  });

  useEffect(() => {
    if (user) {
      fetchStatistics();
    }
  }, [user]);

  const fetchStatistics = async () => {
    try {
      const thirtyDaysAgo = subDays(new Date(), 30);
      
      const { data, error } = await supabase
        .from('calls')
        .select('*')
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      const callsData = data || [];
      setCalls(callsData);
      
      processStatistics(callsData);
    } catch (error) {
      console.error('Error fetching statistics:', error);
      toast.error('שגיאה בטעינת הסטטיסטיקות');
    } finally {
      setLoading(false);
    }
  };

  const processStatistics = (callsData: Call[]) => {
    // Basic stats
    const totalCalls = callsData.length;
    const completedCalls = callsData.filter(c => c.status === 'completed').length;
    const totalDuration = callsData.reduce((acc, c) => acc + (c.duration_seconds || 0), 0);
    const avgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;
    const successRate = totalCalls > 0 ? Math.round((completedCalls / totalCalls) * 100) : 0;

    // Daily data for line chart
    const dailyMap = new Map<string, { calls: number; totalDuration: number }>();
    for (let i = 29; i >= 0; i--) {
      const date = format(subDays(new Date(), i), 'yyyy-MM-dd');
      dailyMap.set(date, { calls: 0, totalDuration: 0 });
    }
    
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

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold">סטטיסטיקות מתקדמות</h1>
          <p className="text-muted-foreground">נתונים מ-30 הימים האחרונים</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalCalls}</p>
                  <p className="text-sm text-muted-foreground">סה"כ שיחות</p>
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
                <div>
                  <p className="text-2xl font-bold">{stats.completedCalls}</p>
                  <p className="text-sm text-muted-foreground">הושלמו</p>
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
                <div>
                  <p className="text-2xl font-bold">{stats.successRate}%</p>
                  <p className="text-sm text-muted-foreground">אחוז הצלחה</p>
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
                  <p className="text-2xl font-bold">{formatDuration(stats.avgDuration)}</p>
                  <p className="text-sm text-muted-foreground">זמן ממוצע</p>
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
                <div>
                  <p className="text-lg font-bold">{formatTotalDuration(stats.totalDuration)}</p>
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
              <CardDescription>30 הימים האחרונים</CardDescription>
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
