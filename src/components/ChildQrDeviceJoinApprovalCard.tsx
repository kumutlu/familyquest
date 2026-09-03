import React, { useState } from 'react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { QrCode, Smartphone, UserCheck, ShieldAlert } from 'lucide-react';
import { formatDate } from '../i18n/format';

export interface ManagedChildOption {
  id: string;
  displayName: string;
  avatarUrl?: string;
}

export interface ChildQrDeviceJoinApprovalCardProps {
  request: {
    id: string;
    status: string;
    sortDate: Date;
    type?: string;
    requesterUid?: string;
  };
  managedChildren: ManagedChildOption[];
  onApprove: (selectedChildId: string) => Promise<void>;
  onReject: () => Promise<void>;
  isProcessing: boolean;
}

export function ChildQrDeviceJoinApprovalCard({
  request,
  managedChildren,
  onApprove,
  onReject,
  isProcessing,
}: ChildQrDeviceJoinApprovalCardProps) {
  const [selectedChildId, setSelectedChildId] = useState<string>('');

  const isPending = request.status === 'pending';

  const handleApprove = () => {
    if (!selectedChildId || isProcessing) return;
    onApprove(selectedChildId);
  };

  return (
    <Card className={isPending ? 'border-indigo-200 bg-indigo-50/20 dark:bg-indigo-950/20' : 'opacity-75'}>
      <CardContent className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                Child Device Join Request
              </h4>
              <Badge variant="primary" className="text-[10px] bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <QrCode className="w-3 h-3 inline mr-1" /> QR Scan
              </Badge>
            </div>

            <p className="font-semibold text-slate-900 dark:text-white leading-tight mb-2">
              A new child device scanned your QR code and requests to join your family.
            </p>

            {isPending && (
              <div className="mt-3 p-3 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Select Existing Managed Child:
                </label>
                {managedChildren.length === 0 ? (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                    <ShieldAlert className="w-4 h-4 shrink-0" />
                    <span>No managed child profiles found. Create a child profile first.</span>
                  </div>
                ) : (
                  <select
                    data-testid="child-selector-dropdown"
                    value={selectedChildId}
                    onChange={(e) => setSelectedChildId(e.target.value)}
                    className="w-full text-sm py-2 px-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="">-- Choose Managed Child --</option>
                    {managedChildren.map((child) => (
                      <option key={child.id} value={child.id}>
                        {child.displayName}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <p className="text-xs text-slate-400 mt-2">{formatDate(request.sortDate)}</p>
          </div>
        </div>

        <div className="flex gap-2 shrink-0 self-end md:self-center">
          {isPending ? (
            <>
              <Button
                data-testid="reject-qr-join-button"
                size="sm"
                variant="danger"
                disabled={isProcessing}
                onClick={onReject}
              >
                Reject
              </Button>
              <Button
                data-testid="approve-qr-join-button"
                size="sm"
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5"
                disabled={!selectedChildId || isProcessing}
                onClick={handleApprove}
              >
                <UserCheck className="w-4 h-4" />
                Approve & Bind
              </Button>
            </>
          ) : (
            <Badge variant={request.status === 'approved' ? 'success' : 'danger'}>
              {request.status}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
