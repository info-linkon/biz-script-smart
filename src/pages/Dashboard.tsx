import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Phone, Calendar, FileText, TrendingUp, Clock, Mic, ArrowLeft, Languages, Zap, Radio, Settings } from 'lucide-react';
import { format } from 'date-fns';
import { he } from 'date-fns/locale';
import { OnboardingStatusCard } from '@/components/onboarding/OnboardingStatusCard';
import { type VoiceProvider } from '@/lib/voice-provider';

interface DashboardStats {
  totalCalls: number;
  todayCalls: number;
  upcomingAppointments: number;
  activeScripts: number;
  languageStats: {
    he: number;
    ar: number;
    en: number;
  };
}

interface RecentCall {
  id: string;
  caller_name: string | null;
  created_at: string;
  call_type: string;
  summary: string | null;
}

interface UpcomingAppointment {
  id: string;
  customer_name: string;
  title: string;
  start_time: string;
}

interface AgentStatus {
  hasAgent: boolean;
  voiceProvider: VoiceProvider | null;
  phoneNumber: string | null;
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalCalls: 0,
    todayCalls: 0,
    upcomingAppointments: 0,
    activeScripts: 0,
    languageStats: { he: 0, ar: 0, en: 0 },
  });
  const [recentCalls, setRecentCalls] = useState<RecentCall[]>([]);
  const [upcomingAppointments, setUpcomingAppointments] = useState<UpcomingAppointment[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({
    hasAgent: false,
    voiceProvider: null,
    phoneNumber: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchDashboardData();
      fetchAgentStatus();
    }
  }, [user]);

  const fetchAgentStatus = async () => {
    try {
      // Fetch profile for provider info
      const { data: profile } = await supabase
        .from('profiles')
        .select('voice_provider, elevenlabs_agent_id, vapi_assistant_id')
        .eq('user_id', user!.id)
        .maybeSingle();

      // Fetch active phone number
      const { data: phoneNumber } = await supabase
        .from('phone_numbers')
        .select('phone_number')
        .eq('user_id', user!.id)
        .eq('status', 'active')
        .maybeSingle();

      const hasAgent = !!(profile?.elevenlabs_agent_id || profile?.vapi_assistant_id);
      
      setAgentStatus({
        hasAgent,
        voiceProvider: (profile?.voice_provider as VoiceProvider) || null,
        phoneNumber: phoneNumber?.phone_number || null,
      });
    } catch (error) {
      console.error('Error fetching agent status:', error);
    }
  };

  const fetchDashboardData = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch calls count
      const { count: totalCalls } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true });

      const { count: todayCalls } = await supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());

      // Fetch upcoming appointments
      const { data: appointments, count: appointmentsCount } = await supabase
        .from('appointments')
        .select('*', { count: 'exact' })
        .gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true })
        .limit(5);

      // Fetch active scripts count
      const { count: scriptsCount } = await supabase
        .from('scripts')
        .select('*', { count: 'exact', head: true })
        .eq('is_active', true);

      // Fetch recent calls with language data
      const { data: calls } = await supabase
        .from('calls')
        .select('id, caller_name, created_at, call_type, summary, language')
        .order('created_at', { ascending: false })
        .limit(5);

      // Fetch all calls for language stats
      const { data: allCalls } = await supabase
        .from('calls')
        .select('language');

      // Calculate language stats
      const languageStats = { he: 0, ar: 0, en: 0 };
      allCalls?.forEach(call => {
        const lang = call.language as keyof typeof languageStats;
        if (lang && languageStats.hasOwnProperty(lang)) {
          languageStats[lang]++;
        }
      });

      setStats({
        totalCalls: totalCalls || 0,
        todayCalls: todayCalls || 0,
        upcomingAppointments: appointmentsCount || 0,
        activeScripts: scriptsCount || 0,
        languageStats,
      });

      setRecentCalls(calls || []);
      setUpcomingAppointments(appointments || []);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    {
      title: 'סה"כ שיחות',
      value: stats.totalCalls,
      icon: Phone,
      color: 'bg-primary/10 text-primary',
      description: 'כל השיחות',
    },
    {
      title: 'שיחות היום',
      value: stats.todayCalls,
      icon: TrendingUp,
      color: 'bg-accent/10 text-accent-foreground',
      description: 'מאז חצות',
    },
    {
      title: 'פגישות קרובות',
      value: stats.upcomingAppointments,
      icon: Calendar,
      color: 'bg-secondary text-secondary-foreground',
      description: 'בהמתנה',
    },
    {
      title: 'תסריטים פעילים',
      value: stats.activeScripts,
      icon: FileText,
      color: 'bg-muted text-muted-foreground',
      description: 'פועלים כעת',
    },
  ];

  const hasLanguageData = stats.languageStats.he > 0 || stats.languageStats.ar > 0 || stats.languageStats.en > 0;

  const getProviderInfo = (provider: VoiceProvider | null) => {
    if (provider === 'vapi') {
      return {
        name: 'Vapi.ai',
        icon: Radio,
        gradient: 'from-blue-500 to-purple-600',
        bgColor: 'bg-blue-500/10',
        textColor: 'text-blue-600',
        description: 'תמיכה מלאה בעברית וערבית',
      };
    }
    return {
      name: 'ElevenLabs',
      icon: Zap,
      gradient: 'from-yellow-400 to-orange-500',
      bgColor: 'bg-orange-500/10',
      textColor: 'text-orange-600',
      description: 'קול טבעי ואיכותי',
    };
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Onboarding Status - shows only if not complete */}
        <OnboardingStatusCard />

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">שלום! 👋</h1>
            <p className="text-muted-foreground">הנה סיכום הפעילות שלך</p>
          </div>
          <Button
            onClick={() => navigate('/agent')}
            className="gradient-primary text-white shadow-lg shadow-primary/25"
          >
            <Mic className="ml-2 h-4 w-4" />
            התחל שיחה עם הסוכן
          </Button>
        </div>

        {/* Voice Provider Status Card */}
        {agentStatus.hasAgent && (
          <Card className="border-0 shadow-sm overflow-hidden">
            <div className={`h-1 bg-gradient-to-r ${getProviderInfo(agentStatus.voiceProvider).gradient}`} />
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {/* Provider Icon */}
                  <div className={`h-12 w-12 rounded-xl ${getProviderInfo(agentStatus.voiceProvider).bgColor} flex items-center justify-center`}>
                    {agentStatus.voiceProvider === 'vapi' ? (
                      <Radio className={`h-6 w-6 ${getProviderInfo(agentStatus.voiceProvider).textColor}`} />
                    ) : (
                      <Zap className={`h-6 w-6 ${getProviderInfo(agentStatus.voiceProvider).textColor}`} />
                    )}
                  </div>
                  
                  {/* Provider Info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">ספק קול פעיל</h3>
                      <span className={`text-sm font-medium px-2 py-0.5 rounded-full ${getProviderInfo(agentStatus.voiceProvider).bgColor} ${getProviderInfo(agentStatus.voiceProvider).textColor}`}>
                        {getProviderInfo(agentStatus.voiceProvider).name}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {getProviderInfo(agentStatus.voiceProvider).description}
                    </p>
                  </div>
                </div>

                {/* Phone Number & Settings */}
                <div className="flex items-center gap-4">
                  {agentStatus.phoneNumber && (
                    <div className="text-left hidden sm:block">
                      <p className="text-xs text-muted-foreground">מספר טלפון</p>
                      <p className="font-mono font-medium" dir="ltr">{agentStatus.phoneNumber}</p>
                    </div>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => navigate('/settings')}
                    className="gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    <span className="hidden sm:inline">הגדרות</span>
                  </Button>
                </div>
              </div>

              {/* Mobile Phone Number */}
              {agentStatus.phoneNumber && (
                <div className="mt-3 pt-3 border-t sm:hidden">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">מספר טלפון:</span>
                    <span className="font-mono font-medium" dir="ltr">{agentStatus.phoneNumber}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat) => (
            <Card key={stat.title} className="border-0 shadow-sm hover:shadow-md transition-shadow">
              <CardContent className="p-4 lg:p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl lg:text-3xl font-bold mt-1">{stat.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">{stat.description}</p>
                  </div>
                  <div className={`p-2 lg:p-3 rounded-xl ${stat.color}`}>
                    <stat.icon className="h-5 w-5 lg:h-6 lg:w-6" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Language Stats */}
        {hasLanguageData && (
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Languages className="h-5 w-5" />
                התפלגות שפות בשיחות
              </CardTitle>
              <CardDescription>שפות שזוהו אוטומטית בשיחות</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🇮🇱</span>
                  <div>
                    <p className="text-xl font-bold">{stats.languageStats.he}</p>
                    <p className="text-sm text-muted-foreground">עברית</p>
                  </div>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🇸🇦</span>
                  <div>
                    <p className="text-xl font-bold">{stats.languageStats.ar}</p>
                    <p className="text-sm text-muted-foreground">ערבית</p>
                  </div>
                </div>
                <div className="h-8 w-px bg-border" />
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🇺🇸</span>
                  <div>
                    <p className="text-xl font-bold">{stats.languageStats.en}</p>
                    <p className="text-sm text-muted-foreground">אנגלית</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent Activity */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Recent Calls */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-lg">שיחות אחרונות</CardTitle>
                <CardDescription>5 השיחות האחרונות</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/calls')}>
                הכל
                <ArrowLeft className="mr-1 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {recentCalls.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Phone className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p>אין שיחות עדיין</p>
                  <Button
                    variant="link"
                    onClick={() => navigate('/agent')}
                    className="mt-2"
                  >
                    התחל שיחה ראשונה
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentCalls.map((call) => (
                    <div
                      key={call.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                      onClick={() => navigate('/calls')}
                    >
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <Phone className="h-4 w-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">
                          {call.caller_name || 'לקוח אנונימי'}
                        </p>
                        <p className="text-sm text-muted-foreground truncate">
                          {call.summary || 'אין סיכום'}
                        </p>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(call.created_at), 'HH:mm', { locale: he })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Appointments */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-lg">פגישות קרובות</CardTitle>
                <CardDescription>הפגישות הבאות שלך</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/calendar')}>
                הכל
                <ArrowLeft className="mr-1 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              {upcomingAppointments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Calendar className="h-12 w-12 mx-auto mb-2 opacity-20" />
                  <p>אין פגישות קרובות</p>
                  <Button
                    variant="link"
                    onClick={() => navigate('/calendar')}
                    className="mt-2"
                  >
                    הוסף פגישה
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcomingAppointments.map((apt) => (
                    <div
                      key={apt.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer"
                      onClick={() => navigate('/calendar')}
                    >
                      <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center">
                        <Clock className="h-4 w-4 text-accent-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{apt.title}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {apt.customer_name}
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium">
                          {format(new Date(apt.start_time), 'HH:mm', { locale: he })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(apt.start_time), 'dd/MM', { locale: he })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
