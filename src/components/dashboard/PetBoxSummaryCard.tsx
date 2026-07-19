import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { Progress } from '../ui/Progress';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { useStore } from '../../store/useStore';
import { PawPrint, ArrowRight } from 'lucide-react';

/**
 * Compact Pet Box summary for the Home dashboard.
 *
 * Reuses the existing bootstrap `funds` data (no new queries). Shows the number
 * of active funds and the combined balance, with a small progress indicator
 * against the sum of emergency goals. Links to /pet-box.
 */
export function PetBoxSummaryCard() {
  const navigate = useNavigate();
  const { funds } = useStore();

  const { fundCount, totalBalance, totalEmergencyGoal, pct } = useMemo(() => {
    const list = funds || [];
    const balance = list.reduce((sum: number, f: any) => sum + (f.balance || 0), 0);
    const emergency = list.reduce((sum: number, f: any) => sum + (f.emergencyGoal || 0), 0);
    const progress = emergency > 0 ? Math.min(100, (balance / emergency) * 100) : 0;
    return {
      fundCount: list.length,
      totalBalance: balance,
      totalEmergencyGoal: emergency,
      pct: progress,
    };
  }, [funds]);

  return (
    <Card data-testid="petbox-summary">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PawPrint size={18} className="text-primary-500" />
          Pet Box
        </CardTitle>
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-600"
          onClick={() => navigate('/pet-box')}
          data-testid="petbox-summary-link"
        >
          Open <ArrowRight size={16} />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="flex items-end justify-between mb-2">
          <div>
            <p className="text-xs font-medium uppercase text-gray-500">Active funds</p>
            <p className="text-2xl font-extrabold text-gray-900">{fundCount}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase text-gray-500">Balance</p>
            <p className="font-bold text-success-600">
              <CurrencyDisplay amountPence={totalBalance} forceColor={false} />
            </p>
          </div>
        </div>

        {totalEmergencyGoal > 0 ? (
          <div>
            <Progress value={pct} max={100} color="success" />
            <p className="mt-1 text-xs text-gray-500">
              {Math.round(pct)}% of {<CurrencyDisplay amountPence={totalEmergencyGoal} forceColor={false} />} emergency goal
            </p>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            {fundCount === 0 ? 'No pets added yet.' : 'No emergency goal set.'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
