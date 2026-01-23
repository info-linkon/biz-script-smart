import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { 
  Users, 
  Search,
  Eye,
  Shield,
  ShieldOff,
  Mail,
  Phone,
  Building,
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
  address?: string | null;
  business_type?: string | null;
}

interface Plan {
  id: string;
  name: string;
  name_he: string;
  price_monthly: number;
}

interface AdminUsersProps {
  users: User[];
  plans: Plan[];
  currentUserId: string | undefined;
  onRefresh: () => void;
}

export function AdminUsers({ users, plans, currentUserId, onRefresh }: AdminUsersProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [showUserDialog, setShowUserDialog] = useState(false);

  const handleToggleAdmin = async (userId: string | null, currentIsAdmin: boolean) => {
    if (!userId) {
      toast.error('משתמש לא חוקי');
      return;
    }

    if (currentIsAdmin) {
      const { error } = await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', 'admin');

      if (error) {
        toast.error('שגיאה בהסרת הרשאות מנהל');
      } else {
        toast.success('הרשאות המנהל הוסרו בהצלחה');
        onRefresh();
      }
    } else {
      const { error } = await supabase
        .from('user_roles')
        .insert({ user_id: userId, role: 'admin' });

      if (error) {
        toast.error('שגיאה בהוספת הרשאות מנהל');
      } else {
        toast.success('הרשאות מנהל נוספו בהצלחה');
        onRefresh();
      }
    }
  };

  const handleChangePlan = async (userId: string | null, planId: string) => {
    if (!userId) return;

    const { error } = await supabase
      .from('profiles')
      .update({ 
        subscription_plan_id: planId,
        subscription_status: 'active'
      })
      .eq('user_id', userId);

    if (error) {
      toast.error('שגיאה בעדכון התוכנית');
    } else {
      toast.success('התוכנית עודכנה בהצלחה');
      onRefresh();
      setShowUserDialog(false);
    }
  };

  const filteredUsers = users.filter(u => {
    const matchesSearch = 
      u.business_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      u.phone?.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = 
      statusFilter === 'all' ||
      (statusFilter === 'active' && u.subscription_status === 'active') ||
      (statusFilter === 'inactive' && u.subscription_status !== 'active') ||
      (statusFilter === 'admin' && u.is_admin);

    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                ניהול משתמשים
              </CardTitle>
              <CardDescription>
                {users.length} משתמשים במערכת
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="חיפוש לפי שם או טלפון..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="סינון לפי סטטוס" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">הכל</SelectItem>
                  <SelectItem value="active">פעילים</SelectItem>
                  <SelectItem value="inactive">לא פעילים</SelectItem>
                  <SelectItem value="admin">מנהלים</SelectItem>
                </SelectContent>
              </Select>
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
                    <div className="flex items-center gap-2">
                      {u.business_name || 'לא צוין'}
                      {u.is_admin && (
                        <Badge variant="destructive" className="text-xs">
                          <Shield className="h-3 w-3 ml-1" />
                          מנהל
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>{u.phone || 'לא צוין'}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{u.plan_name || 'ללא תוכנית'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.subscription_status === 'active' ? 'default' : 'secondary'}>
                      {u.subscription_status === 'active' ? 'פעיל' : 'לא פעיל'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {new Date(u.created_at).toLocaleDateString('he-IL')}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setSelectedUser(u);
                          setShowUserDialog(true);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleAdmin(u.user_id, u.is_admin)}
                        disabled={u.user_id === currentUserId}
                        title={u.is_admin ? 'הסר הרשאות מנהל' : 'הוסף הרשאות מנהל'}
                      >
                        {u.is_admin ? (
                          <ShieldOff className="h-4 w-4 text-destructive" />
                        ) : (
                          <Shield className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredUsers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              לא נמצאו משתמשים
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Details Dialog */}
      <Dialog open={showUserDialog} onOpenChange={setShowUserDialog}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>פרטי משתמש</DialogTitle>
            <DialogDescription>צפייה ועריכת פרטי המשתמש</DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Building className="h-4 w-4" />
                    שם העסק
                  </div>
                  <p className="font-medium">{selectedUser.business_name || 'לא צוין'}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    טלפון
                  </div>
                  <p className="font-medium">{selectedUser.phone || 'לא צוין'}</p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    תאריך הצטרפות
                  </div>
                  <p className="font-medium">
                    {new Date(selectedUser.created_at).toLocaleDateString('he-IL')}
                  </p>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Shield className="h-4 w-4" />
                    סטטוס
                  </div>
                  <div className="flex gap-2">
                    <Badge variant={selectedUser.subscription_status === 'active' ? 'default' : 'secondary'}>
                      {selectedUser.subscription_status === 'active' ? 'פעיל' : 'לא פעיל'}
                    </Badge>
                    {selectedUser.is_admin && (
                      <Badge variant="destructive">מנהל</Badge>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">שינוי תוכנית</label>
                <Select 
                  value={selectedUser.subscription_plan_id || ''} 
                  onValueChange={(value) => handleChangePlan(selectedUser.user_id, value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="בחר תוכנית" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map(plan => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name_he} - ₪{plan.price_monthly}/חודש
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUserDialog(false)}>
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
