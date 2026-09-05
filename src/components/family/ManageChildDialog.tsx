import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  User,
  Smartphone,
  Coins,
  KeyRound,
  Trash2,
  X,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { Button } from '../ui/Button';
import { AvatarPicker } from '../profile/AvatarPicker';
import { getAvatarById, resolveAvatarImage } from '../../config/avatarCatalog';
import { useAccessibleDialog } from './useAccessibleDialog';
import { ConnectChildDeviceQrModal } from '../ConnectChildDeviceQrModal';
import { ChildLoginSection } from './ChildLoginSection';
import { CreateChildLoginDialog } from './CreateChildLoginDialog';
import { deleteChild, mapChildLoginError } from '../../lib/childLoginApi';
import { useStore } from '../../store/useStore';
import { formatMoney } from '../../lib/walletPresentation';

export interface ManageChildMember {
  id: string;
  displayName: string;
  avatarUrl?: string;
  avatarId?: string;
  role?: string;
  isManaged?: boolean;
  hasLogin?: boolean;
  username?: string;
  loginEnabled?: boolean;
  requiresPasswordChange?: boolean;
  lastLogin?: unknown;
  walletBalance?: number;
}

export interface ManageChildDialogProps {
  member: ManageChildMember;
  onClose: () => void;
  onChildUpdated?: () => void;
  onChildDeleted?: () => void;
}

export function ManageChildDialog({
  member,
  onClose,
  onChildUpdated,
  onChildDeleted,
}: ManageChildDialogProps) {
  const { t } = useTranslation(['family', 'common']);
  const childWallets = useStore((state) => state.childWallets);
  const wallet = childWallets?.find((w: any) => w.id === member.id);
  const currentBalance = wallet?.balance ?? member.walletBalance ?? 0;

  // Section 1: Profile State
  const [displayName, setDisplayName] = useState(member.displayName || '');
  const [selectedAvatarId, setSelectedAvatarId] = useState<string | null>(member.avatarId || null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  // Section 2: Devices & QR Modal State
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);

  // Section 4: Login Creation Modal State
  const [createLoginFor, setCreateLoginFor] = useState<any>(null);

  // Section 5: Danger Zone Delete State
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteInFlight = useRef(false);

  const dialogRef = useAccessibleDialog(
    onClose,
    !isQrModalOpen && !createLoginFor && !isConfirmingDelete,
  );

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || isSavingProfile) return;

    const def = selectedAvatarId ? getAvatarById(selectedAvatarId) : undefined;
    if (def && def.unlockType === 'points') {
      setProfileError(t('family:editMember.freeAvatarError', { defaultValue: 'Please choose a standard avatar' }));
      return;
    }

    setIsSavingProfile(true);
    setProfileError(null);
    setProfileSuccess(false);
    try {
      const update: Record<string, unknown> = { displayName: displayName.trim() };
      if (selectedAvatarId) {
        update.avatarId = selectedAvatarId;
        update.avatarUrl = resolveAvatarImage(selectedAvatarId, member.avatarUrl) || '';
      }
      await updateDoc(doc(db, 'users', member.id), update);
      setProfileSuccess(true);
      onChildUpdated?.();
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (err: any) {
      setProfileError(err?.message || t('family:editMember.updateError', { defaultValue: 'Failed to update profile' }));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleDeleteChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (deleteConfirmationName.trim() !== member.displayName) {
      setDeleteError(t('family:login.deleteNameMismatch', { defaultValue: "The name you entered doesn't match" }));
      return;
    }
    if (deleteInFlight.current || isDeleting) return;
    deleteInFlight.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await deleteChild(member.id, member.displayName);
      setIsConfirmingDelete(false);
      onChildDeleted?.();
      onClose();
    } catch (err: any) {
      setDeleteError(mapChildLoginError(err));
    } finally {
      deleteInFlight.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 backdrop-blur-sm p-4 overflow-y-auto">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="manage-child-title"
          tabIndex={-1}
          className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 my-8 overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 outline-none"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
                {member.displayName?.[0]?.toUpperCase() || 'C'}
              </div>
              <div>
                <h3 id="manage-child-title" className="text-lg font-bold text-slate-900 dark:text-white">
                  Manage {member.displayName}
                </h3>
                <span className="text-xs text-slate-500 font-medium">Managed Child Account</span>
              </div>
            </div>
            <button
              type="button"
              aria-label={t('common:closeDialog', { defaultValue: 'Close dialog' })}
              onClick={onClose}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Dialog Body */}
          <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Section 1: Profile */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <User className="w-4 h-4 text-indigo-500" />
                <span>Profile & Appearance</span>
              </div>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                {profileError && (
                  <p role="alert" className="text-xs text-red-600 font-medium">
                    {profileError}
                  </p>
                )}
                {profileSuccess && (
                  <p className="text-xs text-emerald-600 font-medium">Profile saved successfully!</p>
                )}
                <div>
                  <label htmlFor="child-display-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Display Name
                  </label>
                  <input
                    id="child-display-name"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                    Avatar
                  </label>
                  <AvatarPicker
                    selectedAvatarId={selectedAvatarId}
                    ownedAvatarIds={[]}
                    pointsBalance={0}
                    onSelect={setSelectedAvatarId}
                    onRequestUnlock={() => undefined}
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm" disabled={isSavingProfile}>
                    {isSavingProfile ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    Save Profile
                  </Button>
                </div>
              </form>
            </div>

            {/* Section 2: Devices & Access */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <Smartphone className="w-4 h-4 text-indigo-500" />
                <span>Devices & Access</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Connect a phone or tablet so {member.displayName} can log in independently using a secure QR scan.
              </p>
              <Button
                type="button"
                data-testid="connect-child-device-button"
                variant="outline"
                size="sm"
                onClick={() => setIsQrModalOpen(true)}
                className="w-full flex items-center justify-center gap-2 rounded-xl text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/50"
              >
                <Smartphone className="w-4 h-4" />
                <span>Connect personal device</span>
              </Button>
            </div>

            {/* Section 3: Money / Wallet */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <Coins className="w-4 h-4 text-emerald-500" />
                <span>Money & Wallet</span>
              </div>
              <div className="p-3 bg-white border border-gray-200 rounded-xl text-center">
                <span className="block text-xl font-bold text-emerald-600">
                  {formatMoney(currentBalance)}
                </span>
                <span className="text-[11px] font-semibold text-slate-500">Current Balance</span>
              </div>
            </div>

            {/* Section 4: Child Settings / Login */}
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
              <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
                <KeyRound className="w-4 h-4 text-indigo-500" />
                <span>Account Credentials</span>
              </div>
              <ChildLoginSection
                member={member as any}
                onRequestCreate={(m) => setCreateLoginFor(m)}
              />
            </div>

            {/* Section 5: Danger Zone */}
            <div className="p-4 rounded-2xl bg-red-50/50 dark:bg-red-950/20 border border-red-200/80 dark:border-red-900/50 space-y-3">
              <div className="flex items-center gap-2 text-red-700 dark:text-red-400 font-bold text-sm">
                <Trash2 className="w-4 h-4" />
                <span>Danger Zone</span>
              </div>
              <p className="text-xs text-red-600/90 dark:text-red-400/90">
                Removing {member.displayName} will safely delete their account, wallet, and history. This action cannot be undone.
              </p>
              <Button
                type="button"
                data-testid="remove-child-button"
                variant="danger"
                size="sm"
                className="w-full"
                onClick={() => setIsConfirmingDelete(true)}
              >
                Remove {member.displayName}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Scoped QR Device Connect Modal */}
      {isQrModalOpen && (
        <ConnectChildDeviceQrModal
          isOpen={true}
          intent="existing_child_device_bind"
          targetChildId={member.id}
          targetChildName={member.displayName}
          onClose={() => setIsQrModalOpen(false)}
        />
      )}

      {/* Create Child Login Dialog */}
      {createLoginFor && (
        <CreateChildLoginDialog
          member={createLoginFor}
          onClose={() => setCreateLoginFor(null)}
          onSuccess={() => {
            setCreateLoginFor(null);
            onChildUpdated?.();
          }}
        />
      )}

      {/* Delete Confirmation Modal */}
      {isConfirmingDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl border border-red-200 dark:border-red-900/50 p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="p-3 bg-red-100 dark:bg-red-950/50 text-red-600 rounded-full w-12 h-12 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                Delete {member.displayName}?
              </h4>
              <p className="text-xs text-slate-500 mt-1">
                To confirm deletion, please type <strong className="text-slate-900 dark:text-white font-bold">{member.displayName}</strong> below:
              </p>
            </div>
            <form onSubmit={handleDeleteChild} className="space-y-3">
              {deleteError && (
                <p role="alert" className="text-xs text-red-600 font-medium text-center">
                  {deleteError}
                </p>
              )}
              <input
                type="text"
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder={member.displayName}
                className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-red-500 outline-none text-gray-900"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  disabled={isDeleting}
                  onClick={() => {
                    setIsConfirmingDelete(false);
                    setDeleteConfirmationName('');
                    setDeleteError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  data-testid="confirm-delete-child-button"
                  className="flex-1"
                  disabled={isDeleting || deleteConfirmationName.trim() !== member.displayName}
                >
                  {isDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Delete
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
