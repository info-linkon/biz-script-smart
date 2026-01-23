import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Plus, Edit2, Trash2, FileText, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';

interface FAQ {
  question: string;
  answer: string;
}

interface Script {
  id: string;
  name: string;
  business_hours: string | null;
  services: string[] | null;
  faq: FAQ[];
  tone: string;
  language: string;
  is_active: boolean;
  created_at: string;
  custom_prompt: string | null;
  greeting_message: string | null;
  voice_id: string | null;
}

export default function Scripts() {
  const { user } = useAuth();
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<Script | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [businessHours, setBusinessHours] = useState('');
  const [services, setServices] = useState('');
  const [faq, setFaq] = useState<FAQ[]>([{ question: '', answer: '' }]);
  const [tone, setTone] = useState('friendly');
  const [language, setLanguage] = useState('he');
  const [customPrompt, setCustomPrompt] = useState('');
  const [greetingMessage, setGreetingMessage] = useState('');

  useEffect(() => {
    if (user) {
      fetchScripts();
    }
  }, [user]);

  const fetchScripts = async () => {
    try {
      const { data, error } = await supabase
        .from('scripts')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data to match our interface
      const transformedData = (data || []).map(script => ({
        ...script,
        faq: Array.isArray(script.faq) ? (script.faq as unknown as FAQ[]) : [],
        custom_prompt: script.custom_prompt || null,
        greeting_message: script.greeting_message || null,
        voice_id: script.voice_id || null,
      }));
      
      setScripts(transformedData);
    } catch (error) {
      console.error('Error fetching scripts:', error);
      toast.error('שגיאה בטעינת התסריטים');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setName('');
    setBusinessHours('');
    setServices('');
    setFaq([{ question: '', answer: '' }]);
    setTone('friendly');
    setLanguage('he');
    setCustomPrompt('');
    setGreetingMessage('');
    setEditingScript(null);
  };

  const openEditDialog = (script: Script) => {
    setEditingScript(script);
    setName(script.name);
    setBusinessHours(script.business_hours || '');
    setServices(script.services?.join(', ') || '');
    setFaq(script.faq.length > 0 ? script.faq : [{ question: '', answer: '' }]);
    setTone(script.tone);
    setLanguage(script.language);
    setCustomPrompt(script.custom_prompt || '');
    setGreetingMessage(script.greeting_message || '');
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error('נא להזין שם לתסריט');
      return;
    }

    setSaving(true);

    try {
      const faqData = faq.filter(f => f.question.trim() && f.answer.trim());
      const scriptData = {
        user_id: user!.id,
        name: name.trim(),
        business_hours: businessHours.trim() || null,
        services: services.split(',').map(s => s.trim()).filter(Boolean),
        faq: faqData as unknown as null,
        tone,
        language,
        custom_prompt: customPrompt.trim() || null,
        greeting_message: greetingMessage.trim() || null,
      };

      let savedScriptId: string | null = null;

      if (editingScript) {
        const { error } = await supabase
          .from('scripts')
          .update(scriptData)
          .eq('id', editingScript.id);

        if (error) throw error;
        savedScriptId = editingScript.id;
        toast.success('התסריט עודכן בהצלחה');
      } else {
        const { data, error } = await supabase
          .from('scripts')
          .insert(scriptData)
          .select('id')
          .single();

        if (error) throw error;
        savedScriptId = data?.id || null;
        toast.success('התסריט נוצר בהצלחה');
      }

      // Sync with ElevenLabs Agent if user has one
      if (savedScriptId) {
        await syncWithElevenLabs(savedScriptId);
      }

      setDialogOpen(false);
      resetForm();
      fetchScripts();
    } catch (error) {
      console.error('Error saving script:', error);
      toast.error('שגיאה בשמירת התסריט');
    } finally {
      setSaving(false);
    }
  };

  const syncWithElevenLabs = async (scriptId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('elevenlabs-update-agent', {
        body: { script_id: scriptId }
      });

      if (error) {
        console.error('ElevenLabs sync error:', error);
        // Don't show error if user doesn't have an agent yet
        return;
      }

      if (data?.success) {
        toast.success('הסוכן עודכן בהצלחה ב-ElevenLabs');
      } else if (data?.error?.includes('No agent found')) {
        // User hasn't purchased a phone number yet, silent fail
        console.log('No agent to sync with yet');
      } else if (data?.error) {
        console.error('ElevenLabs sync failed:', data.error);
      }
    } catch (err) {
      console.error('Failed to sync with ElevenLabs:', err);
    }
  };

  const toggleActive = async (script: Script) => {
    try {
      const { error } = await supabase
        .from('scripts')
        .update({ is_active: !script.is_active })
        .eq('id', script.id);

      if (error) throw error;
      
      toast.success(script.is_active ? 'התסריט הושבת' : 'התסריט הופעל');
      
      // Sync with ElevenLabs if activating a script
      if (!script.is_active) {
        await syncWithElevenLabs(script.id);
      }
      
      fetchScripts();
    } catch (error) {
      console.error('Error toggling script:', error);
      toast.error('שגיאה בעדכון התסריט');
    }
  };

  const deleteScript = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק את התסריט?')) return;

    try {
      const { error } = await supabase
        .from('scripts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      toast.success('התסריט נמחק בהצלחה');
      fetchScripts();
    } catch (error) {
      console.error('Error deleting script:', error);
      toast.error('שגיאה במחיקת התסריט');
    }
  };

  const addFaqItem = () => {
    setFaq([...faq, { question: '', answer: '' }]);
  };

  const updateFaqItem = (index: number, field: 'question' | 'answer', value: string) => {
    const newFaq = [...faq];
    newFaq[index][field] = value;
    setFaq(newFaq);
  };

  const removeFaqItem = (index: number) => {
    if (faq.length > 1) {
      setFaq(faq.filter((_, i) => i !== index));
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">תסריטים</h1>
            <p className="text-muted-foreground">ניהול תסריטי שיחה לסוכן ה-AI</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button className="gradient-primary text-white">
                <Plus className="ml-2 h-4 w-4" />
                תסריט חדש
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <DialogHeader>
                <DialogTitle>{editingScript ? 'עריכת תסריט' : 'תסריט חדש'}</DialogTitle>
                <DialogDescription>
                  הגדר את המידע שהסוכן ישתמש בו כדי לענות ללקוחות
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="name">שם התסריט *</Label>
                  <Input
                    id="name"
                    placeholder="למשל: מסעדת הגריל"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="hours">שעות פעילות</Label>
                  <Input
                    id="hours"
                    placeholder="למשל: א'-ה' 09:00-18:00, ו' 09:00-14:00"
                    value={businessHours}
                    onChange={(e) => setBusinessHours(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="services">שירותים (מופרדים בפסיקים)</Label>
                  <Input
                    id="services"
                    placeholder="למשל: תספורת, צביעה, החלקה"
                    value={services}
                    onChange={(e) => setServices(e.target.value)}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>טון שיחה</Label>
                    <Select value={tone} onValueChange={setTone}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="friendly">ידידותי</SelectItem>
                        <SelectItem value="professional">מקצועי</SelectItem>
                        <SelectItem value="casual">יומיומי</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>שפה</Label>
                    <Select value={language} onValueChange={setLanguage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="he">עברית</SelectItem>
                        <SelectItem value="en">אנגלית</SelectItem>
                        <SelectItem value="both">שתיהן</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="greetingMessage">הודעת פתיחה</Label>
                  <Textarea
                    id="greetingMessage"
                    placeholder="שלום! הגעתם לעסק שלנו. איך אוכל לעזור?"
                    value={greetingMessage}
                    onChange={(e) => setGreetingMessage(e.target.value)}
                    rows={2}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="customPrompt">הנחיות מותאמות לסוכן</Label>
                  <Textarea
                    id="customPrompt"
                    placeholder="הוסף הנחיות מיוחדות לסוכן, למשל: תמיד הצע הנחה לקולות חוזרים"
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    rows={3}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>שאלות נפוצות</Label>
                    <Button type="button" variant="outline" size="sm" onClick={addFaqItem}>
                      <Plus className="h-4 w-4 ml-1" />
                      הוסף
                    </Button>
                  </div>
                  {faq.map((item, index) => (
                    <div key={index} className="space-y-2 p-3 rounded-lg bg-secondary/50">
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="שאלה"
                          value={item.question}
                          onChange={(e) => updateFaqItem(index, 'question', e.target.value)}
                        />
                        {faq.length > 1 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeFaqItem(index)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                      <Textarea
                        placeholder="תשובה"
                        value={item.answer}
                        onChange={(e) => updateFaqItem(index, 'answer', e.target.value)}
                        rows={2}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  ביטול
                </Button>
                <Button onClick={handleSubmit} disabled={saving} className="gradient-primary text-white">
                  {saving ? (
                    <>
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                      שומר...
                    </>
                  ) : (
                    editingScript ? 'עדכון' : 'צור תסריט'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Scripts List */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : scripts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium mb-2">אין תסריטים עדיין</h3>
              <p className="text-muted-foreground text-center mb-4">
                צור תסריט ראשון כדי שהסוכן ידע איך לענות ללקוחות
              </p>
              <Button onClick={() => setDialogOpen(true)} className="gradient-primary text-white">
                <Plus className="ml-2 h-4 w-4" />
                צור תסריט ראשון
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {scripts.map((script) => (
              <Card key={script.id} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle className="text-lg">{script.name}</CardTitle>
                        <CardDescription>
                          {script.language === 'he' ? 'עברית' : script.language === 'en' ? 'אנגלית' : 'עברית ואנגלית'}
                          {' • '}
                          {script.tone === 'friendly' ? 'ידידותי' : script.tone === 'professional' ? 'מקצועי' : 'יומיומי'}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={script.is_active ? 'default' : 'secondary'}>
                        {script.is_active ? 'פעיל' : 'מושבת'}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {script.services?.slice(0, 5).map((service, i) => (
                      <Badge key={i} variant="outline">{service}</Badge>
                    ))}
                    {script.services && script.services.length > 5 && (
                      <Badge variant="outline">+{script.services.length - 5}</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActive(script)}
                    >
                      {script.is_active ? (
                        <>
                          <ToggleRight className="ml-1 h-4 w-4" />
                          השבת
                        </>
                      ) : (
                        <>
                          <ToggleLeft className="ml-1 h-4 w-4" />
                          הפעל
                        </>
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(script)}
                    >
                      <Edit2 className="ml-1 h-4 w-4" />
                      ערוך
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => deleteScript(script.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="ml-1 h-4 w-4" />
                      מחק
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}