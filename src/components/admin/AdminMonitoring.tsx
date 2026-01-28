import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Activity, 
  Zap, 
  Clock, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle,
  RefreshCw,
  Server,
  Mic,
  Volume2,
  MessageSquare
} from 'lucide-react';

interface HealthStatus {
  timestamp: string;
  mediaBridge: {
    configured: boolean;
    status: {
      status: string;
      activeSessions?: number;
      error?: string;
    } | null;
    stats: {
      sessions?: Array<{
        sessionId: string;
        callSid: string;
        duration: number;
        turnsCount: number;
        validated: boolean;
      }>;
      circuitBreaker?: Record<string, {
        isOpen: boolean;
        failures: number;
        openedAt: number;
      }>;
      activeJtis?: number;
    } | null;
  };
  calls: {
    active: number;
  };
  performance: {
    avgTtfsMs: number;
    avgEndToAudioMs: number;
    sttFailures24h: number;
    bargeIns24h: number;
    metricsCount: number;
  };
  rateLimiting: {
    eventsLastHour: number;
  };
  alerts: {
    unreadBilling: number;
    billingAlerts: Array<{
      id: string;
      alert_type: string;
      message: string;
      created_at: string;
    }>;
  };
}

export function AdminMonitoring() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchHealth = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('health-check');
      
      if (error) {
        console.error('Health check error:', error);
        toast.error('שגיאה בבדיקת תקינות המערכת');
        return;
      }
      
      setHealth(data);
    } catch (error) {
      console.error('Failed to fetch health:', error);
      toast.error('לא ניתן להתחבר לבדיקת תקינות');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchHealth();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'healthy':
        return <Badge className="bg-green-500/20 text-green-500 border-green-500/30"><CheckCircle2 className="h-3 w-3 mr-1" />תקין</Badge>;
      case 'error':
        return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />שגיאה</Badge>;
      case 'unreachable':
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500"><AlertTriangle className="h-3 w-3 mr-1" />לא נגיש</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getCircuitBadge = (isOpen: boolean) => {
    if (isOpen) {
      return <Badge variant="destructive" className="text-xs">פתוח</Badge>;
    }
    return <Badge className="bg-green-500/20 text-green-500 border-green-500/30 text-xs">סגור</Badge>;
  };

  const getPerformanceColor = (value: number, good: number, warning: number) => {
    if (value <= good) return 'text-green-500';
    if (value <= warning) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="space-y-6">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">ניטור מערכת</h2>
          <p className="text-sm text-muted-foreground">
            עדכון אחרון: {health?.timestamp ? new Date(health.timestamp).toLocaleTimeString('he-IL') : 'לא ידוע'}
          </p>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          רענן
        </Button>
      </div>

      {/* Media Bridge Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="h-5 w-5 text-primary" />
              <CardTitle className="text-lg">Media Bridge</CardTitle>
            </div>
            {health?.mediaBridge.configured ? (
              health?.mediaBridge.status ? 
                getStatusBadge(health.mediaBridge.status.status) :
                <Badge variant="secondary">לא מוגדר</Badge>
            ) : (
              <Badge variant="outline">לא מוגדר</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {health?.mediaBridge.configured ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {health.mediaBridge.status?.activeSessions || 0}
                </div>
                <div className="text-xs text-muted-foreground">סשנים פעילים</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {health.mediaBridge.stats?.activeJtis || 0}
                </div>
                <div className="text-xs text-muted-foreground">טוקנים פעילים</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold text-primary">
                  {health.calls?.active || 0}
                </div>
                <div className="text-xs text-muted-foreground">שיחות פעילות</div>
              </div>
              <div className="text-center p-3 bg-muted/50 rounded-lg">
                <div className="text-2xl font-bold">
                  {health.rateLimiting?.eventsLastHour || 0}
                </div>
                <div className="text-xs text-muted-foreground">אירועי Rate Limit</div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Media Bridge לא מוגדר. השתמש בסביבת Edge Functions.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Circuit Breakers */}
      {health?.mediaBridge.stats?.circuitBreaker && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              <CardTitle className="text-lg">Circuit Breakers</CardTitle>
            </div>
            <CardDescription>מצב שירותים חיצוניים</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(health.mediaBridge.stats.circuitBreaker).map(([service, state]) => (
                <div 
                  key={service}
                  className={`p-3 rounded-lg border ${state.isOpen ? 'border-red-500/50 bg-red-500/10' : 'border-green-500/30 bg-green-500/5'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    {service === 'google-stt' && <Mic className="h-4 w-4" />}
                    {service === 'google-tts' && <Volume2 className="h-4 w-4" />}
                    {service === 'dialogflow' && <MessageSquare className="h-4 w-4" />}
                    {service === 'media-bridge' && <Server className="h-4 w-4" />}
                    {getCircuitBadge(state.isOpen)}
                  </div>
                  <div className="text-sm font-medium">{service}</div>
                  <div className="text-xs text-muted-foreground">
                    כשלים: {state.failures}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Performance Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-blue-500" />
            <CardTitle className="text-lg">ביצועים (24 שעות)</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">TTFS</span>
                <span className={`font-bold ${getPerformanceColor(health?.performance.avgTtfsMs || 0, 250, 500)}`}>
                  {health?.performance.avgTtfsMs || 0}ms
                </span>
              </div>
              <Progress 
                value={Math.min((health?.performance.avgTtfsMs || 0) / 10, 100)} 
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">יעד: &lt;250ms</p>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">End-to-Audio</span>
                <span className={`font-bold ${getPerformanceColor(health?.performance.avgEndToAudioMs || 0, 900, 1500)}`}>
                  {health?.performance.avgEndToAudioMs || 0}ms
                </span>
              </div>
              <Progress 
                value={Math.min((health?.performance.avgEndToAudioMs || 0) / 20, 100)} 
                className="h-2"
              />
              <p className="text-xs text-muted-foreground">יעד: &lt;900ms</p>
            </div>

            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-orange-500">
                {health?.performance.sttFailures24h || 0}
              </div>
              <div className="text-xs text-muted-foreground">כשלי STT</div>
            </div>

            <div className="text-center p-3 bg-muted/50 rounded-lg">
              <div className="text-2xl font-bold text-purple-500">
                {health?.performance.bargeIns24h || 0}
              </div>
              <div className="text-xs text-muted-foreground">Barge-ins</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billing Alerts */}
      {health?.alerts && health.alerts.unreadBilling > 0 && (
        <Card className="border-yellow-500/50">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <CardTitle className="text-lg">התראות חיוב</CardTitle>
              <Badge variant="outline" className="text-yellow-500">{health.alerts.unreadBilling}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {health.alerts.billingAlerts.map(alert => (
                <div key={alert.id} className="p-3 bg-yellow-500/10 rounded-lg border border-yellow-500/30">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{alert.alert_type}</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(alert.created_at).toLocaleDateString('he-IL')}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{alert.message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
