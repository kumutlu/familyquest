import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { CurrencyDisplay } from '../ui/CurrencyDisplay';
import { RequestStatusBadge } from './RequestStatusBadge';
import { RequestTimeline } from './RequestTimeline';
import { RequestOutcomeExplanation } from './RequestOutcomeExplanation';
import { getRequestActions } from '../../lib/requestActions';
import { isParentRole } from '../../lib/roles';
import { cn } from '../../lib/utils';
import { formatDate } from '../../i18n/format';
import { resolveAvatarImage } from '../../config/avatarCatalog';
import {
  canApproveMoneyRequest,
  canRejectMoneyRequest,
  canAcceptMoneyRequest,
  type MoneyRequestIdentity,
} from '../../lib/moneyRequestContracts';
import type { NormalizedRequest } from '../../lib/requestModel';

interface RequestDetailContentProps {
  request: NormalizedRequest;
  currentUser?: { id: string; role: string; displayName: string } | null;
  familyId?: string | null;
  onClose: () => void;
  onResolved?: () => void;
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 text-right break-words">{children}</span>
    </div>
  );
}

function formatDateTime(value: number | null): string {
  if (value == null) return '—';
  return formatDate(value, undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function RequestDetailContent({
  request,
  currentUser,
  familyId,
  onClose,
  onResolved,
}: RequestDetailContentProps) {
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const { t } = useTranslation(['requests', 'approvals']);

  const actions = getRequestActions(request.category);
  const isApprover = isParentRole(currentUser?.role);
  const isCreator = !!currentUser?.id && currentUser.id === request.requestedBy?.id;

  // Canonical authorization gate (mirrors Firestore rules). For money requests
  // we derive the identity from the normalized request so the UI never shows
  // an action the rules would deny.
  const moneyIdentity: MoneyRequestIdentity | undefined =
    request.category === 'money_request'
      ? {
          familyId: familyId ?? undefined,
          requesterId: request.requestedBy?.id,
          requestedFromId: request.recipient?.id,
          amountPence: request.amountPence,
          status: request.status,
        }
      : undefined;

  const canAccept =
    request.category === 'money_request' && canAcceptMoneyRequest(moneyIdentity, currentUser);
  const canApprove =
    request.category === 'money_request'
      ? canApproveMoneyRequest(moneyIdentity, currentUser)
      : isApprover && request.statusKind === 'pending';
  const canReject =
    request.category === 'money_request'
      ? canRejectMoneyRequest(moneyIdentity, currentUser)
      : isApprover && request.statusKind === 'pending';
  const canCancel = isCreator && request.statusKind === 'pending';

  const runAction = async (
    kind: 'approve' | 'reject' | 'cancel' | 'accept',
    comment?: string,
  ) => {
    if (!familyId) {
      setError(t('requests:detail.familyNotFound'));
      return;
    }
    setProcessing(true);
    setError('');
    try {
      if (kind === 'accept') {
        await actions.accept?.(familyId, request.id);
      } else if (kind === 'approve') await actions.approve?.(familyId, request.id);
      else if (kind === 'reject') await actions.reject?.(familyId, request.id, comment ?? '');
      else if (kind === 'cancel') await actions.cancel?.(familyId, request.id);
      setConfirm(null);
      onResolved?.();
      onClose();
    } catch (err: any) {
      setError(`${err?.code ? `${err.code}: ` : ''}${err?.message || t('requests:detail.somethingWentWrong')}`);
    } finally {
      setProcessing(false);
    }
  };

  const hasMoneyDetails = request.amountPence != null;

  return (
    <div className="space-y-6">
      {/* Request Information */}
      <section>
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-1">
          {t('requests:detail.information')}
        </h4>
        <div className="divide-y divide-gray-50">
          {request.requestedBy && (
            <InfoRow label={t('requests:detail.requestedBy')}>
              <span className="inline-flex items-center gap-2">
                <Avatar src={request.requestedBy.avatarUrl} fallback={(request.requestedBy.name || '?')[0]} size="sm" />
                {request.requestedBy.name}
              </span>
            </InfoRow>
          )}
          {request.recipient && (
            <InfoRow label={t('requests:detail.recipient')}>
              <span className="inline-flex items-center gap-2">
                {request.recipient.avatarUrl && (
                  <Avatar src={request.recipient.avatarUrl} fallback={(request.recipient.name || '?')[0]} size="sm" />
                )}
                {request.recipient.name}
              </span>
            </InfoRow>
          )}
          <InfoRow label={t('requests:detail.requestType')}>{request.typeLabel}</InfoRow>
          <InfoRow label={t('requests:detail.created')}>{formatDateTime(request.createdAt)}</InfoRow>
          <InfoRow label="Status">
            <RequestStatusBadge statusKind={request.statusKind} statusLabel={request.statusLabel} />
          </InfoRow>
        </div>
      </section>

      {/* Profile change diff */}
      {request.profileChange && (
        <section>
          <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2">{t('requests:detail.profileChanges')}</h4>
          <div className="rounded-xl bg-gray-50 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 w-24 shrink-0">{t('requests:detail.displayName')}</span>
              <span className="line-through text-gray-400">{request.profileChange.currentDisplayName || '—'}</span>
              <ArrowRight size={14} className="text-gray-400" />
              <span className="font-semibold text-gray-900">{request.profileChange.requestedDisplayName}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 w-24 shrink-0">{t('requests:detail.avatar')}</span>
              <Avatar
                src={resolveAvatarImage(request.profileChange.currentAvatarId, request.profileChange.currentAvatar)}
                fallback={(request.profileChange.currentDisplayName || '?')[0]}
                size="sm"
              />
              <ArrowRight size={14} className="text-gray-400" />
              <Avatar
                src={resolveAvatarImage(request.profileChange.requestedAvatarId, request.profileChange.requestedAvatar)}
                fallback={(request.profileChange.requestedDisplayName || '?')[0]}
                size="sm"
              />
            </div>
          </div>
        </section>
      )}

      {/* Money Details */}
      {hasMoneyDetails && (
        <section>
          <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-1">{t('requests:detail.moneyDetails')}</h4>
          <div className="divide-y divide-gray-50">
            <InfoRow label={t('requests:detail.amount')}>
              <span className="font-bold text-gray-900">
                <CurrencyDisplay amountPence={request.amountPence!} forceColor={false} />
              </span>
            </InfoRow>
            {request.message && (
              <InfoRow label={t('requests:detail.message')}>
                <span className="break-words">{request.message}</span>
              </InfoRow>
            )}
            <InfoRow label={t('requests:detail.moneyMoved')}>
              <span className={cn(request.moneyMoved ? 'text-success-600' : 'text-gray-500')}>
                {request.moneyMoved ? t('requests:detail.yes') : t('requests:detail.no')}
              </span>
            </InfoRow>
          </div>
        </section>
      )}

      {/* Outcome */}
      <RequestOutcomeExplanation outcome={request.outcome} />

      {/* Timeline */}
      <section>
        <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">{t('requests:detail.timeline')}</h4>
        <RequestTimeline events={request.timeline} />
      </section>

      {/* Actions / confirmations — sticky footer on mobile so Approve/Reject never get clipped */}
      {((canApprove || canReject || canCancel || canAccept) || confirm !== null || error) && (
        <div className="sticky bottom-0 -mx-6 border-t border-gray-100 bg-white px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {!processing && !error && (canApprove || canReject || canCancel || canAccept) && confirm === null && (
            <div className="flex flex-col gap-2">
              {canAccept && (
                <Button
                  className="bg-success-500 hover:bg-success-600 text-white"
                  fullWidth
                  onClick={() => runAction('accept')}
                  disabled={processing}
                >
                  {t('requests:detail.acceptRequest')}
                </Button>
              )}
              {canCancel && !canApprove && !canReject && (
                <Button variant="outline" fullWidth onClick={() => runAction('cancel')} disabled={processing}>
                  {t('requests:detail.cancelRequest')}
                </Button>
              )}
              {canApprove && canReject && (
                <>
                  <Button
                    variant="danger"
                    fullWidth
                    onClick={() => setConfirm('reject')}
                  >
                    {t('approvals:reject')}
                  </Button>
                  <Button
                    className="bg-success-500 hover:bg-success-600 text-white"
                    fullWidth
                    onClick={() => setConfirm('approve')}
                  >
                    {t('approvals:approve')}
                  </Button>
                </>
              )}
              {canCancel && (canApprove || canReject) && (
                <Button variant="ghost" fullWidth onClick={() => runAction('cancel')}>
                  {t('requests:detail.cancelRequest')}
                </Button>
              )}
            </div>
          )}

          {/* Approve confirmation */}
          {confirm === 'approve' && (
            <div className="rounded-2xl bg-warning-50 border border-warning-200 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-500" />
                <p className="text-sm text-gray-800 break-words">
                  {t('requests:detail.approveConfirmPrefix')}
                  <span className="font-semibold">
                    {request.amountPence != null ? (
                      <CurrencyDisplay amountPence={request.amountPence} forceColor={false} />
                    ) : (
                      request.typeLabel
                    )}
                  </span>
                  {t('requests:detail.approveConfirmSuffix')}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" fullWidth onClick={() => setConfirm(null)} disabled={processing}>
                  {t('requests:detail.back')}
                </Button>
                <Button
                  className="bg-success-500 hover:bg-success-600 text-white"
                  fullWidth
                  onClick={() => runAction('approve')}
                  disabled={processing}
                >
                  {processing ? t('approvals:approving') : t('approvals:approve')}
                </Button>
              </div>
            </div>
          )}

          {/* Reject confirmation */}
          {confirm === 'reject' && (
            <div className="rounded-2xl bg-red-50 border border-red-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-800">{t('requests:detail.rejectConfirm')}</p>
              <textarea
                className="w-full rounded-xl border border-gray-200 p-3 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
                rows={3}
                placeholder={t('requests:detail.commentPlaceholder')}
                value={rejectComment}
                onChange={event => setRejectComment(event.target.value)}
              />
              <div className="flex gap-2">
                <Button variant="ghost" fullWidth onClick={() => setConfirm(null)} disabled={processing}>
                  {t('requests:detail.back')}
                </Button>
                <Button
                  variant="danger"
                  fullWidth
                  onClick={() => runAction('reject', rejectComment)}
                  disabled={processing}
                >
                  {processing ? t('approvals:rejecting') : t('approvals:reject')}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-danger-50 text-danger-600 rounded-xl text-sm font-medium break-words">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
