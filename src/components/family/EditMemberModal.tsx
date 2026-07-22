import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/Button';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { getAvatarById, resolveAvatarImage } from '../../config/avatarCatalog';
import { AvatarPicker } from '../profile/AvatarPicker';
import { useAccessibleDialog } from './useAccessibleDialog';

interface EditMemberModalProps {
  member: any;
  onClose: () => void;
}

/**
 * Parent/Owner editing another family member. Uses the curated avatar catalog
 * (free starter avatars only — adults never spend a child's points). Arbitrary
 * avatar URLs are not accepted; legacy URLs are preserved via avatarId fallback.
 */
export function EditMemberModal({ member, onClose }: EditMemberModalProps) {
  const { t } = useTranslation(['family', 'common']);
  const [displayName, setDisplayName] = useState(member.displayName || '');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(member.avatarId || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dialogRef = useAccessibleDialog(onClose);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;

    const def = selectedAvatarId ? getAvatarById(selectedAvatarId) : undefined;
    if (def && def.unlockType === 'points') {
      setError(t('family:editMember.freeAvatarError'));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const update: Record<string, unknown> = { displayName: displayName.trim() };
      if (selectedAvatarId) {
        update.avatarUrl = resolveAvatarImage(selectedAvatarId, member.avatarUrl) || '';
      }
      await updateDoc(doc(db, 'users', member.id), update);
      onClose();
    } catch (err: any) {
      console.error(err);
      setError(t('family:editMember.updateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-member-dialog-title"
        tabIndex={-1}
        className="bg-white w-full max-w-sm rounded-3xl shadow-xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 outline-none"
      >
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h3 id="edit-member-dialog-title" className="text-xl font-bold text-gray-900">{t('family:editMember.title')}</h3>
          <button type="button" aria-label={t('common:closeDialog')} onClick={onClose} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 rounded-full text-gray-500 transition-colors">
            ✕
          </button>
        </div>
        <div className="p-6">
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-lg text-sm font-medium">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="member-displayName" className="block text-sm font-medium text-gray-700 mb-1">{t('family:editMember.displayName')}</label>
              <input
                id="member-displayName"
                type="text"
                required
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>
            <div>
              <span className="block text-sm font-medium text-gray-700 mb-1">{t('family:editMember.chooseAvatar')}</span>
              <AvatarPicker
                selectedAvatarId={selectedAvatarId}
                ownedAvatarIds={[]}
                pointsBalance={0}
                onSelect={setSelectedAvatarId}
                onRequestUnlock={() => {}}
                disabled={isSubmitting}
              />
            </div>
            <div className="pt-4 flex gap-3">
              <Button type="button" variant="outline" fullWidth onClick={onClose}>
                {t('common:cancel')}
              </Button>
              <Button type="submit" fullWidth disabled={isSubmitting} className="bg-primary-500">
                {isSubmitting ? t('common:saving') : t('common:save')}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
