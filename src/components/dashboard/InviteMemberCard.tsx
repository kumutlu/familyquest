import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { Copy, Share2, Pencil, CheckCircle, AlertTriangle, UserPlus, Link2 } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useNavigate } from 'react-router-dom';
import { createFamilyInvitation, type IntendedRole } from '../../lib/familyInvitationApi';
import { buildInviteMessage, buildJoinUrl } from '../../lib/inviteLink';

type CopyStatus = 'idle' | 'copying' | 'copied' | 'error';

export function InviteMemberCard({ onAddChild }: { onAddChild?: () => void }) {
  const { t } = useTranslation(['family', 'common', 'settings']);
  const { familyData } = useStore();
  const inviteCode = familyData?.inviteCode;
  const [copyStatus, setCopyStatus] = useState<CopyStatus>('idle');
  // Selected invite type. Nothing is generated or shared until one of the
  // supported choices has been made.
  const [inviteType, setInviteType] = useState<IntendedRole | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [linkError, setLinkError] = useState(false);
  const navigate = useNavigate();

  // The share link always points at the current origin, so dev, preview and
  // production builds each produce a link that works where it was created.
  const joinLink = generatedCode ? buildJoinUrl(generatedCode) : '';

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

  const introFor = (role: IntendedRole) =>
    role === 'parent' ? t('family:invite.shareIntroParent') : t('family:invite.shareIntroChild');

  /**
   * Creates a role-specific invitation record and shares the resulting
   * code-specific URL. The role lives on the server record only — it is never
   * placed in the URL, so the link cannot be tampered with to change it.
   */
  const shareInvite = async (role: IntendedRole) => {
    if (generating) return;
    setGenerating(true);
    setLinkError(false);
    try {
      const invitation = await createFamilyInvitation(role);
      setGeneratedCode(invitation.code);
      const url = buildJoinUrl(invitation.code);
      const intro = introFor(role);
      const shareData: ShareData = {
        title: t('common:appName'),
        text: intro,
        url,
      };
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share(shareData);
        } catch {
          // Share sheet dismissed or unavailable — fall back to the clipboard.
          await copyToClipboard(buildInviteMessage(intro, url));
        }
      } else {
        await copyToClipboard(buildInviteMessage(intro, url));
      }
    } catch (error) {
      console.error('Failed to create invite link:', error);
      setLinkError(true);
    } finally {
      setGenerating(false);
    }
  };

  const handleManagedChild = () => {
    setInviteType(null);
    setGeneratedCode('');
    if (onAddChild) onAddChild();
    else navigate('/family');
  };

  const choiceClass = (selected: boolean) =>
    `w-full rounded-xl border px-3 py-2 text-left text-sm transition ${
      selected
        ? 'border-primary-500 bg-white text-primary-900'
        : 'border-primary-200 bg-white/60 text-gray-700 hover:border-primary-300'
    }`;

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

      {/* Invite type selection — presented before any link is generated. */}
      <fieldset className="mt-3">
        <legend className="mb-2 text-xs font-medium text-primary-900">
          {t('family:invite.chooseType')}
        </legend>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            aria-pressed={inviteType === 'parent'}
            className={choiceClass(inviteType === 'parent')}
            onClick={() => { setInviteType('parent'); setGeneratedCode(''); setLinkError(false); }}
          >
            <span className="block font-medium">{t('family:invite.typeParent')}</span>
            <span className="block text-xs text-gray-500">{t('family:invite.typeParentHint')}</span>
          </button>
          <button
            type="button"
            aria-pressed={inviteType === 'child'}
            className={choiceClass(inviteType === 'child')}
            onClick={() => { setInviteType('child'); setGeneratedCode(''); setLinkError(false); }}
          >
            <span className="block font-medium">{t('family:invite.typeChild')}</span>
            <span className="block text-xs text-gray-500">{t('family:invite.typeChildHint')}</span>
          </button>
          <button
            type="button"
            className={choiceClass(false)}
            onClick={handleManagedChild}
          >
            <span className="block font-medium">{t('family:invite.typeManaged')}</span>
            <span className="block text-xs text-gray-500">{t('family:invite.typeManagedHint')}</span>
          </button>
        </div>
      </fieldset>

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
            onClick={() => inviteType && shareInvite(inviteType)}
            disabled={!inviteType || generating}
            aria-label={t('common:share')}
          >
            <Share2 size={16} className="mr-1" />
            {generating ? t('family:invite.generating') : t('common:share')}
          </Button>
        </div>
      </div>

      {joinLink && (
        <div className="mt-3 rounded-xl border border-primary-200 bg-white p-3">
          <p className="text-xs font-medium text-primary-900">
            {inviteType === 'parent'
              ? t('family:invite.linkReadyParent')
              : t('family:invite.linkReadyChild')}
          </p>
          <p className="mt-1 break-all font-mono text-xs text-gray-600">{joinLink}</p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => copyToClipboard(buildInviteMessage(introFor(inviteType ?? 'child'), joinLink))}
          >
            <Link2 size={14} className="mr-1" />
            {t('family:invite.generateLink')}
          </Button>
        </div>
      )}

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

      {linkError && (
        <p className="mt-2 flex items-center gap-1 text-sm text-red-600" role="alert">
          <AlertTriangle size={14} />
          {t('family:invite.linkFailed')}
        </p>
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
