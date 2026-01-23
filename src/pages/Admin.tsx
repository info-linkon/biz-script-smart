import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { 
  Users, 
  CreditCard, 
  Search,
  Edit,
  Shield,
  TrendingUp,
  Phone,
  Calendar
} from 'lucide-react';

interface User {
  id: string;
  user_id: string | null;
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

interface Stats {
  totalUsers: number;
  activeUsers: number;
  totalCalls: number;
  totalAppointments: number;
  monthlyRevenue: number;
}

const Admin = () => {
  const { user } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeUsers: 0,
    totalCalls: 0,
    totalAppointments: 0,
    monthlyRevenue: 0
  });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [showPlanDialog, setShowPlanDialog] = useState(false);

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
      fetchStats()
    ]);
    setLoading(false);
  };

  const fetchUsers = async () => {
    // Fetch profiles
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

    // Fetch user roles to determine admins
    const { data: rolesData } = await supabase
      .from('user_roles')
      .select('user_id, role');

    const adminUserIds = new Set(
      rolesData?.filter(r => r.role === 'admin').map(r => r.user_id) || []
    );

    // Fetch plan names
    const { data: plansData } = await supabase
      .from('subscription_plans')
      .select('id, name_he');
    
    const planMap = new Map(plansData?.map(p => [p.id, p.name_he]) || []);
    
    const usersWithPlans: User[] = (profilesData || []).map(u => ({
      id: u.id,
      user_id: u.user_id,
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
    // Get user counts
    const { count: totalUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    const { count: activeUsers } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('subscription_status', 'active');

    // Get calls count
    const { count: totalCalls } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true });

    // Get appointments count
    const { count: totalAppointments } = await supabase
      .from('appointments')
      .select('*', { count: 'exact', head: true });

    // Calculate monthly revenue (simplified)
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
      monthlyRevenue
    });
  };

  const handleUpdatePlan = async () => {
    if (!editingPlan) return;

    const { error } = await supabase
      .from('subscription_plans')
      .update({
        name: editingPlan.name,
        name_he: editingPlan.name_he,
        price_monthly: editingPlan.price_monthly,
        max_calls_per_month: editingPlan.max_calls_per_month,
        max_appointments_per_month: editingPlan.max_appointments_per_month,
        max_scripts: editingPlan.max_scripts,
        has_ai_agent: editingPlan.has_ai_agent,
        has_analytics: editingPlan.has_analytics,
        is_active: editingPlan.is_active
      })
      .eq('id', editingPlan.id);

    if (error) {
      toast.error('שגיאה בעדכון התוכנית');
    } else {
      toast.success('התוכנית עודכנה בהצלחה');
      setShowPlanDialog(false);
      fetchPlans();
    }
  };

  const handleToggleAdmin = async (userId: string | null, currentIsAdmin: boolean) => {
    if (!userId) {
      toast.error('משתמש לא חוקי');
      return;
    }

    if (currentIsAdmin) {
      // Remove admin role
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) {
        toast.error('שגיאה בהסרת הרשאות מנהל');
      } else {
        toast.success('הרשאות המנהל הוסרו בהצלחה');
        fetchUsers();
      }
    } else {
      // Add admin role
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin' });

      if (error) {
        toast.error('שגיאה בהוספת הרשאות מנהל');
      } else {
        toast.success('הרשאות מנהל נוספו בהצלחה');
        fetchUsers();
      }
    }
  };

  const filteredUsers = users.filter(u => 
    u.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.phone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">פאנל מנהל מערכת</h1>
            <p className="text-muted-foreground">ניהול משתמשים, תוכניות וסטטיסטיקות</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalUsers}</p>
                  <p className="text-sm text-muted-foreground">סה"כ משתמשים</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
                  <TrendingUp className="h-5 w-5 text-success" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.activeUsers}</p>
                  <p className="text-sm text-muted-foreground">משתמשים פעילים</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Phone className="h-5 w-5 text-accent" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalCalls}</p>
                  <p className="text-sm text-muted-foreground">סה"כ שיחות</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-warning/10 flex items-center justify-center">
                  <Calendar className="h-5 w-5 text-warning" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.totalAppointments}</p>
                  <p className="text-sm text-muted-foreground">סה"כ פגישות</p>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <CreditCard className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">₪{stats.monthlyRevenue.toLocaleString()}</p>
                  <p className="text-sm text-muted-foreground">הכנסה חודשית</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Subscription Plans */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              תוכניות מנוי
            </CardTitle>
            <CardDescription>ניהול תוכניות ומחירים</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {plans.map(plan => (
                <Card key={plan.id} className={!plan.is_active ? 'opacity-50' : ''}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{plan.name_he}</CardTitle>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditingPlan(plan);
                          setShowPlanDialog(true);
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                    <CardDescription>₪{plan.price_monthly}/חודש</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm space-y-1">
                    <p>{plan.max_calls_per_month === -1 ? 'ללא הגבלה' : plan.max_calls_per_month} שיחות</p>
                    <p>{plan.max_appointments_per_month === -1 ? 'ללא הגבלה' : plan.max_appointments_per_month} פגישות</p>
                    <p>{plan.max_scripts === -1 ? 'ללא הגבלה' : plan.max_scripts} תסריטים</p>
                    <div className="flex gap-2 mt-2">
                      {plan.has_ai_agent && <Badge variant="secondary">AI</Badge>}
                      {plan.has_analytics && <Badge variant="secondary">Analytics</Badge>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Users Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  משתמשים
                </CardTitle>
                <CardDescription>רשימת כל המשתמשים במערכת</CardDescription>
              </div>
              <div className="relative w-64">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">שם העסק</TableHead>
                  <TableHead className="text-right">טלפון</TableHead>
                  <TableHead className="text-right">תוכנית</TableHead>
                  <TableHead className="text-right">סטטוס</TableHead>
                  <TableHead className="text-right">תאריך הצטרפות</TableHead>
                  <TableHead className="text-right">פעולות</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredUsers.map(u => (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      {u.business_name || 'לא צוין'}
                      {u.is_admin && (
                        <Badge variant="destructive" className="mr-2">מנהל</Badge>
                      )}
                    </TableCell>
                    <TableCell>{u.phone || 'לא צוין'}</TableCell>
                    <TableCell>{u.plan_name}</TableCell>
                    <TableCell>
                      <Badge variant={u.subscription_status === 'active' ? 'default' : 'secondary'}>
                        {u.subscription_status === 'active' ? 'פעיל' : 'לא פעיל'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {new Date(u.created_at).toLocaleDateString('he-IL')}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleAdmin(u.user_id, u.is_admin)}
                        disabled={u.user_id === user?.id}
                      >
                        {u.is_admin ? 'הסר מנהל' : 'הפוך למנהל'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Edit Plan Dialog */}
        <Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>עריכת תוכנית</DialogTitle>
              <DialogDescription>עדכן את פרטי התוכנית</DialogDescription>
            </DialogHeader>
            {editingPlan && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>שם באנגלית</Label>
                    <Input
                      value={editingPlan.name}
                      onChange={(e) => setEditingPlan({...editingPlan, name: e.target.value})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>שם בעברית</Label>
                    <Input
                      value={editingPlan.name_he}
                      onChange={(e) => setEditingPlan({...editingPlan, name_he: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>מחיר חודשי (₪)</Label>
                  <Input
                    type="number"
                    value={editingPlan.price_monthly}
                    onChange={(e) => setEditingPlan({...editingPlan, price_monthly: parseFloat(e.target.value)})}
                  />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>מקס' שיחות</Label>
                    <Input
                      type="number"
                      value={editingPlan.max_calls_per_month}
                      onChange={(e) => setEditingPlan({...editingPlan, max_calls_per_month: parseInt(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>מקס' פגישות</Label>
                    <Input
                      type="number"
                      value={editingPlan.max_appointments_per_month}
                      onChange={(e) => setEditingPlan({...editingPlan, max_appointments_per_month: parseInt(e.target.value)})}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>מקס' תסריטים</Label>
                    <Input
                      type="number"
                      value={editingPlan.max_scripts}
                      onChange={(e) => setEditingPlan({...editingPlan, max_scripts: parseInt(e.target.value)})}
                    />
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPlanDialog(false)}>
                ביטול
              </Button>
              <Button onClick={handleUpdatePlan}>
                שמור שינויים
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Admin;
