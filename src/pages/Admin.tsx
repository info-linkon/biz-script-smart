import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { 
  Shield,
  LayoutDashboard,
  Users,
  Phone,
  Calendar,
  CreditCard,
  MessageSquare,
  Activity,
  ShieldAlert
} from 'lucide-react';

import { AdminOverview } from '@/components/admin/AdminOverview';
import { AdminUsers } from '@/components/admin/AdminUsers';
import { AdminCalls } from '@/components/admin/AdminCalls';
import { AdminAppointments } from '@/components/admin/AdminAppointments';
import { AdminPlans } from '@/components/admin/AdminPlans';
import { AdminSupport } from '@/components/admin/AdminSupport';
import { AdminMonitoring } from '@/components/admin/AdminMonitoring';
import { RateLimitMonitor } from '@/components/admin/RateLimitMonitor';

interface User {
  id: string;
  user_id: string | null;
  email: string | null;
  business_name: string | null;
  phone: string | null;
  is_admin: boolean;
  subscription_status: string | null;
  subscription_plan_id: string | null;
  plan_name?: string;
  created_at: string;
}

interface Plan {
  id: string;
  name: string;
  name_he: string;
  price_monthly: number;
  max_calls_per_month: number;
  max_appointments_per_month: number;
  max_scripts: number;
  has_ai_agent: boolean;
  has_analytics: boolean;
  is_active: boolean;
}

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

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalCalls: number;
  totalAppointments: number;
  monthlyRevenue: number;
  newUsersThisMonth?: number;
  callsThisMonth?: number;
}

const Admin = () => {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeUsers: 0,
    totalCalls: 0,
    totalAppointments: 0,
    monthlyRevenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    if (!roleLoading) {
      if (!isAdmin) {
        toast.error('אין לך הרשאות מנהל');
        navigate('/dashboard');
      } else {
        fetchData();
      }
    }
  }, [isAdmin, roleLoading, navigate]);

  const fetchData = async () => {
    await Promise.all([
      fetchUsers(),
      fetchPlans(),
      fetchStats(),
      fetchSupportTickets()
    ]);
    setLoading(false);
  };

  const fetchSupportTickets = async () => {
    try {
      // Fetch all support tickets
      const { data: tickets, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching tickets:', error);
        return;
      }

      // Get user emails from auth.users via profiles
      const userIds = [...new Set(tickets?.map(t => t.user_id) || [])];
      
      // Get profiles for these users
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, business_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.business_name]) || []);

      const ticketsWithUserInfo: SupportTicket[] = (tickets || []).map(ticket => ({
        ...ticket,
        user_email: ticket.user_id, // We'll show the user_id for now
        user_business: profileMap.get(ticket.user_id) || undefined
      }));

      setSupportTickets(ticketsWithUserInfo);
    } catch (error) {
      console.error('Error fetching support tickets:', error);
    }
  };

  const fetchUsers = async () => {
    const { data: profilesData, error: profilesError } = await supabase
      .from('profiles')
      .select(`
        id,
        user_id,
        business_name,
        phone,
        subscription_status,
        subscription_plan_id,
        created_at
      `)
      .order('created_at', { ascending: false });

    if (profilesError) {
      console.error('Error fetching profiles:', profilesError);
      return;
    }

    // Get user emails using the security definer function
    const { data: emailsData } = await supabase.rpc('get_users_with_email');
    const emailMap = new Map(emailsData?.map((e: { user_id: string; email: string }) => [e.user_id, e.email]) || []);

    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('user_id, role');

    const adminUserIds = new Set(
      rolesData?.filter(r => r.role === 'admin').map(r => r.user_id) || []
    );

    const { data: plansData } = await supabase
      .from('subscription_plans')
      .select('id, name_he');
    
    const planMap = new Map(plansData?.map(p => [p.id, p.name_he]) || []);
    
    const usersWithPlans: User[] = (profilesData || []).map(u => ({
      id: u.id,
      user_id: u.user_id,
      email: emailMap.get(u.user_id) || null,
      business_name: u.business_name,
      phone: u.phone,
      subscription_status: u.subscription_status,
      subscription_plan_id: u.subscription_plan_id,
      created_at: u.created_at,
      is_admin: adminUserIds.has(u.user_id),
      plan_name: u.subscription_plan_id ? planMap.get(u.subscription_plan_id) : 'ללא תוכנית'
    }));
    
    setUsers(usersWithPlans);
  };

  const fetchPlans = async () => {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .order('price_monthly', { ascending: true });

    if (!error && data) {
      setPlans(data);
    }
  };

  const fetchStats = async () => {
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: activeUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_status', 'active');

    const { count: totalCalls } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true });

    const { count: totalAppointments } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true });

    // New users this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const { count: newUsersThisMonth } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString());

    // Calls this month
    const { count: callsThisMonth } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', startOfMonth.toISOString());

    // Calculate monthly revenue
    const { data: subscriptions } = await supabase
      .from('profiles')
      .select('subscription_plan_id')
      .eq('subscription_status', 'active');

    const { data: planPrices } = await supabase
      .from('subscription_plans')
      .select('id, price_monthly');

    const priceMap = new Map(planPrices?.map(p => [p.id, p.price_monthly]) || []);
    const monthlyRevenue = subscriptions?.reduce((sum, sub) => {
      return sum + (priceMap.get(sub.subscription_plan_id) || 0);
    }, 0) || 0;

    setStats({
      totalUsers: totalUsers || 0,
      activeUsers: activeUsers || 0,
      totalCalls: totalCalls || 0,
      totalAppointments: totalAppointments || 0,
      monthlyRevenue,
      newUsersThisMonth: newUsersThisMonth || 0,
      callsThisMonth: callsThisMonth || 0
    });
  };

  if (loading || roleLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return null;
  }

  return (
    <AppLayout>
      <div className="space-y-6" dir="rtl">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">פאנל מנהל מערכת</h1>
            <p className="text-muted-foreground">ניהול מלא של המערכת, משתמשים ונתונים</p>
          </div>
        </div>

        {/* Tabs Navigation */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-8 h-12">
            <TabsTrigger value="overview" className="flex items-center gap-2">
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden sm:inline">סקירה</span>
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              <span className="hidden sm:inline">משתמשים</span>
            </TabsTrigger>
            <TabsTrigger value="calls" className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              <span className="hidden sm:inline">שיחות</span>
            </TabsTrigger>
            <TabsTrigger value="appointments" className="flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              <span className="hidden sm:inline">פגישות</span>
            </TabsTrigger>
            <TabsTrigger value="plans" className="flex items-center gap-2">
              <CreditCard className="h-4 w-4" />
              <span className="hidden sm:inline">תוכניות</span>
            </TabsTrigger>
            <TabsTrigger value="support" className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              <span className="hidden sm:inline">תמיכה</span>
            </TabsTrigger>
            <TabsTrigger value="monitoring" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">ניטור</span>
            </TabsTrigger>
            <TabsTrigger value="ratelimits" className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4" />
              <span className="hidden sm:inline">מגבלות</span>
            </TabsTrigger>
          </TabsList>

          <div className="mt-6">
            <TabsContent value="overview">
              <AdminOverview stats={stats} />
            </TabsContent>

            <TabsContent value="users">
              <AdminUsers 
                users={users} 
                plans={plans}
                currentUserId={user?.id}
                onRefresh={fetchUsers}
              />
            </TabsContent>

            <TabsContent value="calls">
              <AdminCalls />
            </TabsContent>

            <TabsContent value="appointments">
              <AdminAppointments />
            </TabsContent>

            <TabsContent value="plans">
              <AdminPlans plans={plans} onRefresh={fetchPlans} />
            </TabsContent>

            <TabsContent value="support">
              <AdminSupport tickets={supportTickets} onRefresh={fetchSupportTickets} />
            </TabsContent>

            <TabsContent value="monitoring">
              <AdminMonitoring />
            </TabsContent>

            <TabsContent value="ratelimits">
              <RateLimitMonitor />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </AppLayout>
  );
};

export default Admin;
