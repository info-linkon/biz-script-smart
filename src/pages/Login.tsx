import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Mic, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { error } = await signIn(email, password);
    
    if (error) {
      toast.error('שגיאה בהתחברות', {
        description: 'אימייל או סיסמה שגויים',
      });
      setLoading(false);
      return;
    }

    // Check if user is admin first, then check onboarding
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Check if user has admin role
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        toast.success('התחברת בהצלחה!');

        // Admin users go directly to admin panel
        if (roleData) {
          navigate('/admin');
          setLoading(false);
          return;
        }

        // Regular users - check onboarding
        const { data: profile } = await supabase
          .from('profiles')
          .select('elevenlabs_agent_id, business_name')
          .eq('user_id', user.id)
          .single();
        
        // If no agent ID or no business name, redirect to onboarding
        if (!profile?.elevenlabs_agent_id || !profile?.business_name) {
          navigate('/onboarding');
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err) {
      // On error, just go to dashboard
      navigate('/dashboard');
    }
    
    setLoading(false);
  };

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-primary/5">
      {/* Decorative elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-accent/10 rounded-full blur-3xl" />
      </div>

      <Card className="w-full max-w-md relative glass">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-16 w-16 rounded-2xl gradient-primary flex items-center justify-center shadow-lg shadow-primary/25">
            <Mic className="h-8 w-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">ברוכים הבאים</CardTitle>
          <CardDescription>
            התחברו לחשבון שלכם כדי לנהל את המענה האוטומטי
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">אימייל</Label>
              <Input
                id="email"
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="text-left"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">סיסמה</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                dir="ltr"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              className="w-full gradient-primary text-white"
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                  מתחבר...
                </>
              ) : (
                'התחברות'
              )}
            </Button>
            <p className="text-sm text-muted-foreground text-center">
              אין לכם חשבון?{' '}
              <Link to="/register" className="text-primary hover:underline font-medium">
                הרשמה
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}