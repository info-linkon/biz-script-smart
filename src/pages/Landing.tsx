import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { 
  Phone, 
  Calendar, 
  Bot, 
  BarChart3, 
  Check, 
  ArrowLeft, 
  Sparkles,
  MessageSquare,
  Clock,
  Users,
  Shield,
  Zap
} from 'lucide-react';

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
}

const Landing = () => {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchPlans();
  }, []);

  const fetchPlans = async () => {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('is_active', true)
      .order('price_monthly', { ascending: true });

    if (!error && data) {
      setPlans(data);
    }
    setLoading(false);
  };

  const features = [
    {
      icon: Bot,
      title: 'סוכן AI חכם',
      description: 'סוכן קולי מבוסס בינה מלאכותית שעונה ללקוחות 24/7'
    },
    {
      icon: Calendar,
      title: 'ניהול פגישות',
      description: 'תיאום פגישות אוטומטי וסנכרון עם יומן העסק'
    },
    {
      icon: Phone,
      title: 'מעקב שיחות',
      description: 'היסטוריה מלאה של כל השיחות כולל תמלולים'
    },
    {
      icon: MessageSquare,
      title: 'צ\'אט חכם',
      description: 'מענה טקסטואלי מבוסס AI לפניות לקוחות'
    },
    {
      icon: BarChart3,
      title: 'אנליטיקס מתקדם',
      description: 'דוחות וסטטיסטיקות לשיפור הביצועים'
    },
    {
      icon: Clock,
      title: 'זמינות 24/7',
      description: 'מענה אוטומטי בכל שעות היממה'
    }
  ];

  const testimonials = [
    {
      name: 'יוסי כהן',
      business: 'מרפאת שיניים',
      text: 'מאז שהתחלנו להשתמש במערכת, ההזמנות עלו ב-40%'
    },
    {
      name: 'מיכל לוי',
      business: 'סטודיו לעיצוב',
      text: 'הסוכן הקולי חוסך לי שעות של מענה טלפוני'
    },
    {
      name: 'דוד אברהם',
      business: 'משרד עורכי דין',
      text: 'לקוחות חדשים מרוצים מהמענה המהיר והמקצועי'
    }
  ];

  const formatLimit = (value: number) => {
    if (value === -1) return 'ללא הגבלה';
    return value.toLocaleString('he-IL');
  };

  return (
    <div className="min-h-screen bg-background" dir="rtl">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 glass">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center">
                <Bot className="h-6 w-6 text-primary-foreground" />
              </div>
              <span className="text-xl font-bold text-foreground">AI Response</span>
            </div>
            <div className="flex items-center gap-4">
              <Link to="/login">
                <Button variant="ghost">התחברות</Button>
              </Link>
              <Link to="/register">
                <Button className="gradient-primary text-primary-foreground">
                  התחל בחינם
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="pt-32 pb-20 px-4">
        <div className="max-w-7xl mx-auto text-center">
          <Badge className="mb-6 gradient-accent text-accent-foreground">
            <Sparkles className="h-3 w-3 ml-1" />
            חדש! סוכן AI מתקדם
          </Badge>
          <h1 className="text-4xl md:text-6xl font-bold text-foreground mb-6">
            הסוכן הקולי החכם
            <br />
            <span className="bg-gradient-to-l from-primary to-accent bg-clip-text text-transparent">
              שיענה לעסק שלך 24/7
            </span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-8">
            מערכת SaaS מתקדמת לניהול מענה עסקי אוטומטי. סוכן AI שמבין עברית, 
            מתאם פגישות, ועונה ללקוחות בזמן אמת.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/register">
              <Button size="lg" className="gradient-primary text-primary-foreground text-lg px-8">
                התחל תקופת ניסיון חינם
                <ArrowLeft className="h-5 w-5 mr-2" />
              </Button>
            </Link>
            <Button size="lg" variant="outline" className="text-lg px-8">
              צפה בהדגמה
            </Button>
          </div>
          
          {/* Stats */}
          <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { value: '500+', label: 'עסקים פעילים' },
              { value: '50,000+', label: 'שיחות בחודש' },
              { value: '98%', label: 'שביעות רצון' },
              { value: '24/7', label: 'זמינות מלאה' }
            ].map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-primary">{stat.value}</div>
                <div className="text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              כל מה שהעסק שלך צריך
            </h2>
            <p className="text-xl text-muted-foreground">
              מערכת מענה עסקי מלאה במקום אחד
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="border-border/50 hover:shadow-lg transition-shadow">
                <CardHeader>
                  <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center mb-4">
                    <feature.icon className="h-6 w-6 text-primary-foreground" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground">{feature.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="py-20" id="pricing">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              תוכניות מנוי
            </h2>
            <p className="text-xl text-muted-foreground">
              בחר את התוכנית המתאימה לעסק שלך
            </p>
          </div>

          {loading ? (
            <div className="flex justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {plans.map((plan, index) => (
                <Card 
                  key={plan.id} 
                  className={`relative border-border/50 ${
                    index === 2 ? 'border-primary ring-2 ring-primary/20' : ''
                  }`}
                >
                  {index === 2 && (
                    <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 gradient-primary text-primary-foreground">
                      הכי פופולרי
                    </Badge>
                  )}
                  <CardHeader className="text-center">
                    <CardTitle className="text-xl">{plan.name_he}</CardTitle>
                    <CardDescription>{plan.name}</CardDescription>
                    <div className="mt-4">
                      <span className="text-4xl font-bold text-foreground">
                        ₪{plan.price_monthly}
                      </span>
                      <span className="text-muted-foreground">/חודש</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      <span className="text-sm">
                        {formatLimit(plan.max_calls_per_month)} שיחות
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      <span className="text-sm">
                        {formatLimit(plan.max_appointments_per_month)} פגישות
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-success" />
                      <span className="text-sm">
                        {formatLimit(plan.max_scripts)} תסריטים
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {plan.has_ai_agent ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted" />
                      )}
                      <span className={`text-sm ${!plan.has_ai_agent && 'text-muted-foreground'}`}>
                        סוכן AI
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {plan.has_analytics ? (
                        <Check className="h-4 w-4 text-success" />
                      ) : (
                        <div className="h-4 w-4 rounded-full border-2 border-muted" />
                      )}
                      <span className={`text-sm ${!plan.has_analytics && 'text-muted-foreground'}`}>
                        אנליטיקס מתקדם
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Link to="/register" className="w-full">
                      <Button 
                        className={`w-full ${
                          index === 2 ? 'gradient-primary text-primary-foreground' : ''
                        }`}
                        variant={index === 2 ? 'default' : 'outline'}
                      >
                        {plan.price_monthly === 0 ? 'התחל בחינם' : 'בחר תוכנית'}
                      </Button>
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Testimonials Section */}
      <section className="py-20 bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
              מה הלקוחות אומרים
            </h2>
          </div>
          
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map((testimonial, index) => (
              <Card key={index} className="border-border/50">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground mb-4">"{testimonial.text}"</p>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full gradient-primary flex items-center justify-center text-primary-foreground font-bold">
                      {testimonial.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-semibold">{testimonial.name}</div>
                      <div className="text-sm text-muted-foreground">{testimonial.business}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Shield className="h-8 w-8 text-success" />
              </div>
              <h3 className="text-xl font-semibold mb-2">אבטחה מלאה</h3>
              <p className="text-muted-foreground">הצפנה מקצה לקצה והגנה על המידע</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">תמיכה 24/7</h3>
              <p className="text-muted-foreground">צוות תמיכה זמין בכל עת</p>
            </div>
            <div className="flex flex-col items-center">
              <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center mb-4">
                <Zap className="h-8 w-8 text-accent" />
              </div>
              <h3 className="text-xl font-semibold mb-2">הפעלה מהירה</h3>
              <p className="text-muted-foreground">מוכן לשימוש תוך דקות</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 gradient-primary">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
            מוכנים להתחיל?
          </h2>
          <p className="text-xl text-primary-foreground/80 mb-8">
            הצטרפו לאלפי עסקים שכבר משתמשים ב-AI Response
          </p>
          <Link to="/register">
            <Button size="lg" variant="secondary" className="text-lg px-8">
              התחל תקופת ניסיון חינם
              <ArrowLeft className="h-5 w-5 mr-2" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-card border-t border-border">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-primary flex items-center justify-center">
                <Bot className="h-4 w-4 text-primary-foreground" />
              </div>
              <span className="font-bold text-foreground">AI Response</span>
            </div>
            <p className="text-muted-foreground text-sm">
              © 2025 AI Response. כל הזכויות שמורות.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Landing;
