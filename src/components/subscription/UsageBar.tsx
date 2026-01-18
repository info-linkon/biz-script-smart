import { Progress } from '@/components/ui/progress';

interface UsageBarProps {
  label: string;
  current: number;
  max: number;
  icon?: React.ReactNode;
}

const UsageBar = ({ label, current, max, icon }: UsageBarProps) => {
  const isUnlimited = max === -1;
  const percentage = isUnlimited ? 0 : Math.min((current / max) * 100, 100);
  const isWarning = percentage >= 80;
  const isCritical = percentage >= 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-foreground">{label}</span>
        </div>
        <span className={`font-medium ${isCritical ? 'text-destructive' : isWarning ? 'text-warning' : 'text-muted-foreground'}`}>
          {isUnlimited ? (
            <span>ללא הגבלה</span>
          ) : (
            <span>{current.toLocaleString('he-IL')} / {max.toLocaleString('he-IL')}</span>
          )}
        </span>
      </div>
      {!isUnlimited && (
        <Progress 
          value={percentage} 
          className={`h-2 ${isCritical ? '[&>div]:bg-destructive' : isWarning ? '[&>div]:bg-warning' : ''}`}
        />
      )}
    </div>
  );
};

export default UsageBar;
