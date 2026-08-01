import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Copy, Share2, Pencil, CheckCircle, AlertTriangle, UserPlus } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';

export function InviteMemberCard({ onAddChild }: { onAddChild?: () => void }) {
  const { t } = useTranslation(['family', 'common', 'settings']);
  const { familyData } = useStore();
  const inviteCode = familyData?.inviteCode;
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  const navigate = useNavigate();

  const joinLink = inviteCode ? `${window.location.origin}/join-family` : '';

  const flashStatus = (status: CopyStatus) => {
    setCopyStatus(status);
    window.setTimeout(() => setCopyStatus('idle'), 3000);
  };

  const copyToClipboard = async (text: string) => {
    if (!text || copyStatus === 'copying') return;
    setCopyStatus('copying');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        flashStatus('copied');
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch (error) {
      console.error('Failed to copy invite text:', error);
      flashStatus('error');
    }
  };

  const handleShare = async () => {
    const shareData: ShareData = {
      title: t('common:appName'),
      text: t('family:inviteMember'),
      url: joinLink,
    };
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share(shareData);
      } catch {
        // User dismissed the share sheet — fall back to copying the link.
        void copyToClipboard(joinLink);
      }
    } else {
      void copyToClipboard(joinLink);
    }
  };

  return (
    <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-primary-900">{t('family:inviteMember')}</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/settings')}
          aria-label={t('settings:familySettings.editInvite')}
        >
          <Pencil size={14} className="mr-1" />
          {t('settings:familySettings.editInvite')}
        </Button>
      </div>

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="flex-1 rounded-xl border border-primary-200 bg-white px-4 py-3 text-center font-mono text-lg font-bold tracking-widest text-primary-700">
          {inviteCode || '—'}
        </code>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => copyToClipboard(inviteCode || '')}
            disabled={!inviteCode || copyStatus === 'copying'}
            aria-label={t('settings:familySettings.copyInviteAria')}
          >
            <Copy size={16} className="mr-1" />
            {t('common:copy')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleShare}
            disabled={!inviteCode}
            aria-label={t('common:share')}
          >
            <Share2 size={16} className="mr-1" />
            {t('common:share')}
          </Button>
        </div>
      </div>

      {onAddChild && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddChild}
          className="mt-3 w-full"
          aria-label={t('family:addChildDirectly')}
        >
          <UserPlus size={14} className="mr-1" />
          {t('family:addChildDirectly')}
        </Button>
      )}

      {copyStatus === 'copied' && (
        <p className="mt-2 flex items-center gap-1 text-sm text-green-600">
          <CheckCircle size={14} />
          {t('settings:familySettings.copied')}
        </p>
      )}
      {copyStatus === 'error' && (
        <p className="mt-2 flex items-center gap-1 text-sm text-red-600">
          <AlertTriangle size={14} />
          {t('settings:familySettings.copyFailed')}
        </p>
      )}
    </div>
  );
}
