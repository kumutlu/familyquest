import { useEffect, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { isChildRole, isOwnerRole, isParentRole } from '../../lib/roles';
import {
  submitProfileUpdateRequest,
  unlockAvatar,
  validateProfileUpdateInput,
} from '../../lib/api';
import { mapTransactionError } from '../../lib/transactionErrors';
import { useStore } from '../../store/useStore';
import { getAvatarById, resolveAvatarImage } from '../../config/avatarCatalog';
import { AvatarPicker } from './AvatarPicker';
import { AvatarUnlockSheet } from './AvatarUnlockSheet';

interface ProfileEditorModalProps {
  user: any;
  onClose: () => void;
}

/**
 * Shared profile editor used by every entry point (Settings, Profile dropdown).
 *
 * - Owner / Parent: edits apply immediately to `users/{id}`. They may pick any
 *   free (starter) avatar from the curated catalog without spending child points.
 * - Child: edits are NOT written directly. They are submitted as a
 *   `profile_update_requests` document that flows through the existing Approval
 *   Center workflow. While a request is pending the editor is locked so a child
 *   can only ever have one active profile request.
 *
 * Avatars are chosen from the curated catalog — children can never paste an
 *   arbitrary URL. Premium avatars are unlocked separately (one-time point cost)
 *   and then selected for the profile change.
 */
export function ProfileEditorModal({ user, onClose }: ProfileEditorModalProps) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(user?.avatarId || null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [unlockTarget, setUnlockTarget] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [unlockProcessing, setUnlockProcessing] = useState(false);

  const canEdit = isOwnerRole(user?.role) || isParentRole(user?.role);
  const isChild = isChildRole(user?.role);

  const profileUpdateRequests = useStore(state => state.profileUpdateRequests);
  const avatarUnlocks = useStore(state => state.avatarUnlocks) || [];
  const pointsBalance = user?.rewardPoints || 0;
  const ownedAvatarIds = avatarUnlocks.map((u: any) => u.avatarId);

  const pendingRequest = isChild
    ? profileUpdateRequests.find(r => r.childId === user?.id && r.status === 'pending')
    : undefined;
  const hasPending = Boolean(pendingRequest);

  // Clear stale errors whenever the user reopens the modal (mount) or changes
  // inputs, so the friendly "please try again" message never sticks around.
  useEffect(() => {
    setError(null);
    setSuccess(null);
  }, []);

  const clearStaleError = () => {
    if (error) setError(null);
  };

  const statusMessage =
    error ||
    success ||
    (hasPending ? 'You have a pending profile update awaiting parent approval.' : null);

  const handleUnlockConfirm = async () => {
    if (!unlockTarget || !user?.familyId) return;
    setUnlockProcessing(true);
    setUnlockError(null);
    try {
      await unlockAvatar(user.familyId, unlockTarget);
      setSelectedAvatarId(unlockTarget);
      setUnlockTarget(null);
      setSuccess('Avatar unlocked! You can now select it for your profile.');
    } catch (err: any) {
      setUnlockError(err?.message || 'We could not unlock this avatar. Please try again.');
    } finally {
      setUnlockProcessing(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Owner / Parent: immediate update (free starter avatars only; no child points spent).
    if (canEdit) {
      if (!displayName.trim()) {
        setError('Display name cannot be empty.');
        return;
      }
      const def = selectedAvatarId ? getAvatarById(selectedAvatarId) : undefined;
      if (def && def.unlockType === 'points') {
        setError('Adults can only use free starter avatars from the catalog.');
        return;
      }
      setIsSubmitting(true);
      try {
        const update: Record<string, unknown> = { displayName: displayName.trim() };
        if (selectedAvatarId) {
          update.avatarId = selectedAvatarId;
          update.avatarUrl = resolveAvatarImage(selectedAvatarId, user?.avatarUrl) || '';
        }
        await updateDoc(doc(db, 'users', user.id), update);
        setSuccess('Profile updated.');
        window.setTimeout(onClose, 900);
      } catch {
        setError('We could not save your profile. Please try again.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Child: submit for parent approval (never writes to users/{childId} here).
    if (isChild) {
      if (hasPending) {
        setError('You already have a profile change waiting for approval.');
        return;
      }
      setIsSubmitting(true);
      try {
        validateProfileUpdateInput(displayName, selectedAvatarId, {
          ownedAvatarIds,
          legacyAvatarUrl: user?.avatarUrl || null,
        });
        await submitProfileUpdateRequest(user.familyId, displayName, selectedAvatarId, {
          ownedAvatarIds,
          legacyAvatarUrl: user?.avatarUrl || null,
        });
        setSuccess('Changes submitted for parent approval.');
        window.setTimeout(onClose, 1400);
      } catch (err: any) {
        // Map internal Firestore / transaction-order errors to a friendly message.
        setError(mapTransactionError(err, { operation: 'submitProfileUpdateRequest' }));
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const locked = isChild && hasPending;
  const selectedDef = selectedAvatarId ? getAvatarById(selectedAvatarId) : undefined;
  const selectedIsLockedPremium =
    selectedDef?.unlockType === 'points' && !ownedAvatarIds.includes(selectedAvatarId || '');

  const header = (
    <div className="shrink-0 px-6 py-4 border-b border-gray-50 flex items-center justify-between">
      <h3 id="modal-title" className="text-lg font-bold text-gray-900">Edit Profile</h3>
      <button
        onClick={onClose}
        aria-label="Close dialog"
        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors ml-auto"
      >
        <span aria-hidden="true" className="text-xl leading-none">×</span>
      </button>
    </div>
  );

  const footer = (
    <div className="flex gap-3">
      <Button type="button" variant="outline" fullWidth onClick={onClose}>
        Cancel
      </Button>
      {canEdit && (
        <Button type="submit" form="profile-editor-form" fullWidth disabled={isSubmitting || !displayName.trim()}>
          {isSubmitting ? 'Saving…' : 'Save'}
        </Button>
      )}
      {isChild && (
        <Button type="submit" form="profile-editor-form" fullWidth disabled={isSubmitting || locked || selectedIsLockedPremium}>
          {isSubmitting ? 'Submitting…' : 'Submit for approval'}
        </Button>
      )}
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title="Edit Profile" header={header} footer={footer}>
      <form id="profile-editor-form" onSubmit={handleSave} noValidate className="space-y-4">
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {statusMessage}
        </div>

        {isChild && !hasPending && (
          <div
            role="status"
            className="p-3 bg-amber-50 text-amber-800 rounded-xl text-sm font-medium border border-amber-200"
          >
            Profile changes are sent to a parent for approval before they take effect.
          </div>
        )}

        {hasPending && (
          <div
            role="status"
            className="p-3 bg-blue-50 text-blue-800 rounded-xl text-sm font-medium border border-blue-200"
          >
            Pending profile update — awaiting parent approval. You cannot submit another change yet.
          </div>
        )}

        {error && (
          <div role="alert" className="p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium">
            {error}
          </div>
        )}
        {success && (
          <div role="status" className="p-3 bg-green-50 text-green-700 rounded-xl text-sm font-medium">
            {success}
          </div>
        )}

        <div>
          <label htmlFor="profile-displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Display Name
          </label>
          <input
            id="profile-displayName"
            type="text"
            required
            disabled={locked}
            value={displayName}
            onChange={e => {
              setDisplayName(e.target.value);
              clearStaleError();
            }}
            className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all disabled:opacity-60"
          />
        </div>

        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">Choose Avatar</span>
          <AvatarPicker
            selectedAvatarId={selectedAvatarId}
            ownedAvatarIds={ownedAvatarIds}
            pointsBalance={pointsBalance}
            onSelect={id => {
              setSelectedAvatarId(id);
              clearStaleError();
            }}
            onRequestUnlock={setUnlockTarget}
            disabled={locked}
          />
          {isChild && (
            <p className="mt-2 text-xs text-gray-500">
              You have <span className="font-semibold text-gray-700">{pointsBalance}</span> points.
              Unlocking a premium avatar costs points once; selecting an owned avatar is free.
            </p>
          )}
          {selectedIsLockedPremium && (
            <p role="alert" className="mt-2 text-xs text-red-500 font-medium">
              This avatar has not been unlocked yet. Unlock it before submitting.
            </p>
          )}
        </div>
      </form>

      {unlockTarget && (
        <AvatarUnlockSheet
          avatarId={unlockTarget}
          pointsBalance={pointsBalance}
          onCancel={() => { setUnlockTarget(null); setUnlockError(null); }}
          onConfirm={handleUnlockConfirm}
          processing={unlockProcessing}
          error={unlockError}
        />
      )}
    </Modal>
  );
}
