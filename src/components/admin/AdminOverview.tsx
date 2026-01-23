import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  CreditCard, 
  TrendingUp,
  Phone,
  Calendar,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalCalls: number;
  totalAppointments: number;
  monthlyRevenue: number;
  newUsersThisMonth?: number;
  callsThisMonth?: number;
}

interface AdminOverviewProps {
  stats: Stats;
}

export function AdminOverview({ stats }: AdminOverviewProps) {
  const statCards = [
    {
      title: 'סה"כ משתמשים',
      value: stats.totalUsers,
      icon: Users,
      color: 'primary',
      trend: stats.newUsersThisMonth ? `+${stats.newUsersThisMonth} החודש` : undefined,
      trendUp: true
    },
    {
      title: 'משתמשים פעילים',
      value: stats.activeUsers,
      icon: TrendingUp,
      color: 'success',
      percentage: stats.totalUsers > 0 ? Math.round((stats.activeUsers / stats.totalUsers) * 100) : 0
    },
    {
      title: 'סה"כ שיחות',
      value: stats.totalCalls,
      icon: Phone,
      color: 'accent',
      trend: stats.callsThisMonth ? `${stats.callsThisMonth} החודש` : undefined
    },
    {
      title: 'סה"כ פגישות',
      value: stats.totalAppointments,
      icon: Calendar,
      color: 'warning'
    },
    {
      title: 'הכנסה חודשית',
      value: `₪${stats.monthlyRevenue.toLocaleString()}`,
      icon: CreditCard,
      color: 'primary',
      isRevenue: true
    }
  ];

  return (
    <div className="space-y-6">
      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {statCards.map((stat, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl bg-${stat.color}/10 flex items-center justify-center`}>
                  <stat.icon className={`h-6 w-6 text-${stat.color}`} />
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-sm text-muted-foreground">{stat.title}</p>
                  {stat.trend && (
                    <div className="flex items-center gap-1 mt-1">
                      {stat.trendUp ? (
                        <ArrowUpRight className="h-3 w-3 text-success" />
                      ) : (
                        <ArrowDownRight className="h-3 w-3 text-destructive" />
                      )}
                      <span className="text-xs text-muted-foreground">{stat.trend}</span>
                    </div>
                  )}
                  {stat.percentage !== undefined && (
                    <Badge variant="secondary" className="mt-1">
                      {stat.percentage}% מהמשתמשים
                    </Badge>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">יחס המרה</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">
              {stats.totalUsers > 0 
                ? `${Math.round((stats.activeUsers / stats.totalUsers) * 100)}%`
                : '0%'
              }
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {stats.activeUsers} מתוך {stats.totalUsers} משתמשים עם מנוי פעיל
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">ממוצע שיחות למשתמש</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-accent">
              {stats.activeUsers > 0 
                ? (stats.totalCalls / stats.activeUsers).toFixed(1)
                : '0'
              }
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              שיחות בממוצע למשתמש פעיל
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">הכנסה ממוצעת</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-success">
              ₪{stats.activeUsers > 0 
                ? Math.round(stats.monthlyRevenue / stats.activeUsers)
                : 0
              }
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              למשתמש פעיל בחודש
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
