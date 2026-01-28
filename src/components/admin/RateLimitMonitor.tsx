import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  ShieldAlert, 
  RefreshCw, 
  Search,
  Clock,
  User,
  Globe,
  Filter
} from 'lucide-react';

interface RateLimitEvent {
  id: string;
  user_id: string | null;
  agent_id: string | null;
  ip_address: string | null;
  operation_type: string;
  limit_type: string;
  created_at: string;
}

interface RateLimitStats {
  total: number;
  byOperation: Record<string, number>;
  byLimitType: Record<string, number>;
  topUsers: Array<{ user_id: string; count: number }>;
}

export function RateLimitMonitor() {
  const [events, setEvents] = useState<RateLimitEvent[]>([]);
  const [stats, setStats] = useState<RateLimitStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [operationFilter, setOperationFilter] = useState<string>('all');
  const [limitTypeFilter, setLimitTypeFilter] = useState<string>('all');

  const fetchEvents = async () => {
    try {
      let query = supabase
        .from('rate_limit_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (operationFilter !== 'all') {
        query = query.eq('operation_type', operationFilter);
      }
      if (limitTypeFilter !== 'all') {
        query = query.eq('limit_type', limitTypeFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching rate limit events:', error);
        toast.error('שגיאה בטעינת אירועי Rate Limit');
        return;
      }

      setEvents(data || []);

      // Calculate stats
      const byOperation: Record<string, number> = {};
      const byLimitType: Record<string, number> = {};
      const userCounts: Record<string, number> = {};

      (data || []).forEach(event => {
        byOperation[event.operation_type] = (byOperation[event.operation_type] || 0) + 1;
        byLimitType[event.limit_type] = (byLimitType[event.limit_type] || 0) + 1;
        if (event.user_id) {
          userCounts[event.user_id] = (userCounts[event.user_id] || 0) + 1;
        }
      });

      const topUsers = Object.entries(userCounts)
        .map(([user_id, count]) => ({ user_id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setStats({
        total: data?.length || 0,
        byOperation,
        byLimitType,
        topUsers
      });

    } catch (error) {
      console.error('Failed to fetch events:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [operationFilter, limitTypeFilter]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchEvents();
  };

  const filteredEvents = events.filter(event => {
    if (!searchTerm) return true;
    const searchLower = searchTerm.toLowerCase();
    return (
      event.user_id?.toLowerCase().includes(searchLower) ||
      event.ip_address?.toLowerCase().includes(searchLower) ||
      event.operation_type.toLowerCase().includes(searchLower)
    );
  });

  const getLimitTypeBadge = (type: string) => {
    switch (type) {
      case 'per_minute':
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500">דקה</Badge>;
      case 'per_hour':
        return <Badge variant="outline" className="text-orange-500 border-orange-500">שעה</Badge>;
      case 'concurrent_max':
        return <Badge variant="destructive">מקביליות</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  const getOperationBadge = (operation: string) => {
    const colors: Record<string, string> = {
      voice_call: 'bg-blue-500/20 text-blue-500',
      media_stream: 'bg-purple-500/20 text-purple-500',
      webhook: 'bg-green-500/20 text-green-500',
      concurrent: 'bg-orange-500/20 text-orange-500'
    };
    return <Badge className={colors[operation] || 'bg-gray-500/20'}>{operation}</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Rate Limit Monitor</h2>
          <p className="text-sm text-muted-foreground">
            מעקב אחר אירועי הגבלת קצב
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

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <ShieldAlert className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <div className="text-2xl font-bold">{stats?.total || 0}</div>
                <div className="text-xs text-muted-foreground">סה"כ אירועים</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {Object.entries(stats?.byOperation || {}).slice(0, 3).map(([op, count]) => (
          <Card key={op}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg">
                  <Globe className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-2xl font-bold">{count}</div>
                  <div className="text-xs text-muted-foreground">{op}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Users */}
      {stats?.topUsers && stats.topUsers.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg flex items-center gap-2">
              <User className="h-5 w-5" />
              משתמשים עם הכי הרבה אירועים
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {stats.topUsers.map(({ user_id, count }) => (
                <Badge key={user_id} variant="outline" className="py-1.5">
                  {user_id.substring(0, 8)}... ({count})
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="h-5 w-5" />
            סינון
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש לפי משתמש או IP..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>
            <Select value={operationFilter} onValueChange={setOperationFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="סוג פעולה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="voice_call">voice_call</SelectItem>
                <SelectItem value="media_stream">media_stream</SelectItem>
                <SelectItem value="webhook">webhook</SelectItem>
                <SelectItem value="concurrent">concurrent</SelectItem>
              </SelectContent>
            </Select>
            <Select value={limitTypeFilter} onValueChange={setLimitTypeFilter}>
              <SelectTrigger className="w-[150px]">
                <SelectValue placeholder="סוג מגבלה" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">הכל</SelectItem>
                <SelectItem value="per_minute">per_minute</SelectItem>
                <SelectItem value="per_hour">per_hour</SelectItem>
                <SelectItem value="concurrent_max">concurrent_max</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Events Table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">אירועים אחרונים</CardTitle>
          <CardDescription>100 אירועים אחרונים</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">זמן</TableHead>
                  <TableHead className="text-right">משתמש</TableHead>
                  <TableHead className="text-right">פעולה</TableHead>
                  <TableHead className="text-right">סוג מגבלה</TableHead>
                  <TableHead className="text-right">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEvents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      לא נמצאו אירועים
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {new Date(event.created_at).toLocaleString('he-IL', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.user_id ? event.user_id.substring(0, 8) + '...' : '-'}
                      </TableCell>
                      <TableCell>{getOperationBadge(event.operation_type)}</TableCell>
                      <TableCell>{getLimitTypeBadge(event.limit_type)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {event.ip_address || '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
