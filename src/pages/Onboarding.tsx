import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Shield } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { createFamilyAndParent, requestToJoinFamily, signOut } from '../lib/api';
import { useStore } from '../store/useStore';

export function Onboarding() {
  const { t } = useTranslation(['auth', 'common']);
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [joinRequested, setJoinRequested] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const currentUser = useStore(state => state.currentUser);
  const refreshCurrentUser = useStore(state => state.refreshCurrentUser);
  const navigate = useNavigate();

  const handleCreateFamily = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !familyName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const { user } = await createFamilyAndParent(
        currentUser.uid,
        currentUser.displayName,
        familyName.trim(),
      );
      refreshCurrentUser(currentUser.uid, { familyId: user.familyId, role: user.role });
      navigate('/', { replace: true });
    } catch (caught: any) {
      setError(caught?.message || t('common:errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      await requestToJoinFamily(currentUser.uid, currentUser.displayName, inviteCode);
      setJoinRequested(true);
    } catch (caught: any) {
      setError(
        caught?.message === 'Invalid invite code'
          ? t('auth:invalidInviteOrClaimCode')
          : caught?.message || t('common:errorOccurred'),
      );
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
        <h2 className="text-3xl font-extrabold text-gray-900">
          {t('auth:welcome', { appName: t('common:appName') })}
        </h2>
        <p className="mt-2 text-sm text-gray-600">{t('auth:getFamilySetup')}</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white p-8 rounded-xl shadow">
        {mode === 'select' && (
          <div className="space-y-4">
            <Button fullWidth size="lg" onClick={() => setMode('create')}>
              {t('auth:createFamily')}
            </Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => setMode('join')}>
              {t('auth:joinWithCode')}
            </Button>
            <div className="pt-4 text-center">
              <button
                onClick={() => signOut()}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                {t('auth:signOut')}
              </button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <form className="space-y-6" onSubmit={handleCreateFamily}>
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold mt-1">{t('auth:nameYourFamily')}</h3>
            </div>
            <input
              type="text"
              required
              placeholder={t('auth:familyNamePlaceholder')}
              value={familyName}
              onChange={event => setFamilyName(event.target.value)}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md"
            />
            {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>
                {t('common:back')}
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? t('common:loading') : t('common:continue')}
              </Button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form className="space-y-6" onSubmit={handleJoin}>
            <div>
              <label htmlFor="family-code" className="block text-sm font-medium text-gray-700">
                {t('auth:inviteCode')}
              </label>
              <input
                id="family-code"
                type="text"
                required
                placeholder={t('auth:inviteCodePlaceholder')}
                value={inviteCode}
                onChange={event => setInviteCode(event.target.value)}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md uppercase"
              />
            </div>
            {error && <p className="text-red-500 text-sm" role="alert">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>
                {t('common:back')}
              </Button>
              <Button type="submit" className="flex-1" disabled={loading}>
                {loading ? t('common:loading') : t('auth:requestToJoin')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
