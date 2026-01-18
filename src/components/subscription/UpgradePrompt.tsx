import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Sparkles, ArrowLeft } from 'lucide-react';

interface UpgradePromptProps {
  feature: string;
  message?: string;
}

const UpgradePrompt = ({ feature, message }: UpgradePromptProps) => {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="pt-6">
        <div className="flex items-start gap-4" dir="rtl">
          <div className="w-12 h-12 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-foreground mb-1">
              שדרג את התוכנית שלך
            </h3>
            <p className="text-sm text-muted-foreground mb-3">
              {message || `התכונה "${feature}" אינה זמינה בתוכנית הנוכחית שלך.`}
            </p>
            <Link to="/#pricing">
              <Button size="sm" className="gradient-primary text-primary-foreground">
                צפה בתוכניות
                <ArrowLeft className="h-4 w-4 mr-2" />
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default UpgradePrompt;
