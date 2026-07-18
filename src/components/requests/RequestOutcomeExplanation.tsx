import { CheckCircle, XCircle } from 'lucide-react';
import type { RequestOutcome } from '../../lib/requestModel';

interface RequestOutcomeExplanationProps {
  outcome?: RequestOutcome;
}

/**
 * Human-readable explanation of what happens next. No technical language — just
 * plain sentences a child or parent can understand at a glance.
 */
export function RequestOutcomeExplanation({ outcome }: RequestOutcomeExplanationProps) {
  if (!outcome) return null;

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider">What happens next</h4>
      <div className="space-y-2">
        <div className="flex items-start gap-2 rounded-xl bg-green-50 p-3">
          <CheckCircle size={18} className="mt-0.5 shrink-0 text-success-500" />
          <p className="text-sm text-gray-700 break-words">
            <span className="font-semibold text-gray-900">If approved: </span>
            {outcome.ifApproved}
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3">
          <XCircle size={18} className="mt-0.5 shrink-0 text-danger-500" />
          <p className="text-sm text-gray-700 break-words">
            <span className="font-semibold text-gray-900">If rejected: </span>
            {outcome.ifRejected}
          </p>
        </div>
      </div>
    </div>
  );
}
