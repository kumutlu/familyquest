import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { createFamilyAndParent, requestToJoinFamily, createManagedMember, updateUserToOwner, signOut } from '../lib/api';
import { useStore } from '../store/useStore';
import { Plus, Shield } from 'lucide-react';

export function Onboarding() {
  const { t } = useTranslation(['auth', 'common']);
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [step, setStep] = useState(1);

  // Create state
  const [familyName, setFamilyName] = useState('');
  const [members, setMembers] = useState<{name: string, role: 'parent'|'child'}[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'parent'|'child'>('child');
  const [generatedFamilyId, setGeneratedFamilyId] = useState('');
  const [generatedInviteCode, setGeneratedInviteCode] = useState('');

  // Join state
  const [inviteCode, setInviteCode] = useState('');
  const [joinRequested, setJoinRequested] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentUser = useStore(state => state.currentUser);
  const navigate = useNavigate();

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      const { familyId, inviteCode } = await createFamilyAndParent(currentUser.uid, currentUser.displayName, familyName);
      setGeneratedFamilyId(familyId);
      setGeneratedInviteCode(inviteCode);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = () => {
    if (!newMemberName.trim()) {
      setError(t('auth:memberNameRequired'));
      return;
    }

    // Check for duplicates
    const trimmedName = newMemberName.trim();
    if (members.some(m => m.name.toLowerCase() === trimmedName.toLowerCase())) {
      setError(t('auth:memberAlreadyExists'));
      return;
    }

    // Update local state only - no Firestore write yet
    setMembers([...members, { name: trimmedName, role: newMemberRole }]);
    setNewMemberName('');
    // Clear role to child for next entry (sensible default)
    setNewMemberRole('child');
    setError('');
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      try {
        await requestToJoinFamily(currentUser.uid, currentUser.displayName, inviteCode);
      } catch (err: any) {
        if (err.message === 'Invalid invite code') {
          const { submitClaimRequest } = await import('../lib/api');
          await submitClaimRequest(currentUser.uid, currentUser.displayName, inviteCode);
        } else {
          throw err;
        }
      }
      setJoinRequested(true);
    } catch (err: any) {
      setError(err.message === 'Invalid invite code' || err.message === 'Invalid claim code' ? t('auth:invalidInviteOrClaimCode') : err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinishSetup = async () => {
    if (!generatedFamilyId) {
      navigate('/');
      return;
    }
    if (!currentUser) return;
    setLoading(true);
    try {
      // Create all managed members in Firestore
      for (const member of members) {
        await createManagedMember(generatedFamilyId, member.role, member.name);
      }
      // Update the parent user to become the owner (set familyId and role='owner')
      await updateUserToOwner(currentUser.uid, generatedFamilyId);
      // Only navigate on success - the route guard will redirect once auth is ready
      navigate('/');
    } catch (err: any) {
      setError(err.message || t('auth:failedToAddMember'));
    } finally {
      setLoading(false);
    }
  };

  if (joinRequested) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white p-8 rounded-xl shadow text-center">
          <Shield className="w-16 h-16 text-primary-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('auth:requestSent')}</h2>
          <p className="text-gray-600 mb-6">{t('auth:requestSentBody')}</p>
          <Button fullWidth onClick={() => signOut()}>{t('auth:signOut')}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900">{t('auth:welcome', { appName: t('common:appName') })}</h2>
        <p className="mt-2 text-sm text-gray-600">{t('auth:getFamilySetup')}</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white p-8 rounded-xl shadow">
        {mode === 'select' && (
          <div className="space-y-4">
            <Button fullWidth size="lg" onClick={() => setMode('create')}>{t('auth:createFamily')}</Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => setMode('join')}>{t('auth:joinWithCode')}</Button>
            <div className="pt-4 text-center">
              <button onClick={() => signOut()} className="text-sm text-gray-400 hover:text-gray-600">{t('auth:signOut')}</button>
            </div>
          </div>
        )}

        {mode === 'create' && step === 1 && (
          <form className="space-y-6" onSubmit={handleCreateFamily}>
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{t('auth:stepOf', { current: 1, total: 3 })}</span>
              <h3 className="text-xl font-bold mt-1">{t('auth:nameYourFamily')}</h3>
            </div>
            <div>
              <input type="text" required placeholder={t('auth:familyNamePlaceholder')} value={familyName} onChange={e => setFamilyName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>{t('common:back')}</Button>
              <Button type="submit" className="flex-1" disabled={loading}>{t('common:continue')}</Button>
            </div>
          </form>
        )}

        {mode === 'create' && step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{t('auth:stepOf', { current: 2, total: 3 })}</span>
              <h3 className="text-xl font-bold mt-1">{t('auth:addFamilyMembers')}</h3>
              <p className="text-sm text-gray-500 mt-2">{t('auth:addMembersHint')}</p>
            </div>

            <div className="space-y-3">
              {members.map((m, i) => (
                <div key={i} className="flex justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="font-medium text-gray-900">{m.name}</span>
                  <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded-full capitalize">{t(`auth:${m.role}`)}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input type="text" placeholder={t('auth:namePlaceholder')} value={newMemberName} onChange={e => setNewMemberName(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
              <select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white">
                <option value="child">{t('auth:child')}</option>
                <option value="parent">{t('auth:parent')}</option>
              </select>
              <Button type="button" onClick={handleAddMember} disabled={!newMemberName.trim()}><Plus size={16} /></Button>
            </div>
            {error && <p className="text-red-500 text-sm mt-2">{error}</p>}

            <div className="pt-6 mt-6 border-t border-gray-100">
              <Button
                fullWidth
                onClick={() => {
                  if (members.length === 0) {
                    setError(t('auth:mustAddAtLeastOneMember'));
                    return;
                  }
                  setError('');
                  setStep(3);
                }}
              >
                {t('auth:continueToInviteCode')}
              </Button>
            </div>
          </div>
        )}

        {mode === 'create' && step === 3 && (
          <div className="space-y-6 text-center">
            <div className="mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{t('auth:stepOf', { current: 3, total: 3 })}</span>
              <h3 className="text-xl font-bold mt-1">{t('auth:inviteOthers')}</h3>
              <p className="text-sm text-gray-500 mt-2">{t('auth:inviteOthersHint')}</p>
            </div>

            <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
              <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">{t('auth:yourInviteCode')}</p>
              <p className="text-4xl font-mono font-black text-primary-600 tracking-widest">{generatedInviteCode}</p>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button fullWidth onClick={handleFinishSetup} disabled={loading}>{t('auth:finishSetup')}</Button>
          </div>
        )}

        {mode === 'join' && (
          <form className="space-y-6" onSubmit={handleJoin}>
            <div>
              <label className="block text-sm font-medium text-gray-700">{t('auth:inviteCode')}</label>
              <input type="text" required placeholder={t('auth:inviteCodePlaceholder')} value={inviteCode} onChange={e => setInviteCode(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md uppercase" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>{t('common:back')}</Button>
              <Button type="submit" className="flex-1" disabled={loading}>{t('auth:requestToJoin')}</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}