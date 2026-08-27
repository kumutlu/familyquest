import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { clearCreateFamilyIntent, readCreateFamilyIntent, startCreateFamilyIntent } from '../auth/createFamilyIntent';
import { Button } from '../components/ui/Button';
import { requestFamilyJoin } from '../lib/familyMembershipApi';
import { OnboardingShell } from '../onboarding/components/OnboardingShell';
import { loadDraft, saveDraft } from '../onboarding/lib/onboardingDraft';
import { useStore } from '../store/useStore';

/** Removes server-reconciliation ids while preserving the user's non-authoritative setup copy. */
function prepareCreationDraft(): void {
  const draft = loadDraft();
  if (!draft) return;
  const {
    familyId: _familyId,
    childId: _childId,
    firstTaskId: _firstTaskId,
    ...personalisation
  } = draft;
  saveDraft({ ...personalisation, step: 'p1', updatedAt: Date.now() });
}

export function NoFamilyChoice() {
  const { t } = useTranslation('onboarding');
  const navigate = useNavigate();
  const authUser = useStore(state => state.authUser);
  const [mode, setMode] = useState<'choice' | 'join'>('choice');
  const [familyCode, setFamilyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uid = authUser?.uid;
  if (!uid) return <Navigate to="/login" replace />;

  const handleCreate = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    prepareCreationDraft();
    startCreateFamilyIntent(uid);
    if (!readCreateFamilyIntent(uid)) {
      setError(t('noFamily.storageError'));
      setBusy(false);
      return;
    }
    navigate('/onboarding?mode=create');
  };

  const handleChooseJoin = () => {
    clearCreateFamilyIntent();
    setError(null);
    setMode('join');
  };

  const handleJoin = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = familyCode.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code) || busy) {
      if (!busy) setError(t('noFamily.invalidCode'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await requestFamilyJoin(code);
      navigate('/join/pending', { replace: true });
    } catch {
      setError(t('noFamily.joinError'));
      setBusy(false);
    }
  };

  return (
    <OnboardingShell eyebrow={t('meta.title')}>
      <div className="rounded-[1.75rem] border border-white/80 bg-white/90 p-6 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <h1 className="text-2xl font-extrabold text-gray-900 dark:text-slate-50 sm:text-3xl">
          {t('noFamily.title')}
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-slate-300">{t('noFamily.body')}</p>

        {error && <p className="mt-4 text-sm text-red-600" role="alert">{error}</p>}

        {mode === 'choice' ? (
          <div className="mt-6 space-y-3">
            <Button type="button" fullWidth size="lg" onClick={handleCreate} disabled={busy}>
              {t('noFamily.create')}
            </Button>
            <Button type="button" fullWidth size="lg" variant="secondary" onClick={handleChooseJoin} disabled={busy}>
              {t('noFamily.join')}
            </Button>
          </div>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={handleJoin} noValidate>
            <div>
              <label htmlFor="adult-family-code" className="block text-sm font-semibold text-gray-700 dark:text-slate-300">
                {t('noFamily.familyCode')}
              </label>
              <input
                id="adult-family-code"
                value={familyCode}
                onChange={event => setFamilyCode(event.target.value)}
                autoComplete="off"
                maxLength={6}
                className="mt-2 block min-h-12 w-full rounded-2xl border border-gray-300 bg-white px-4 py-3 text-center text-lg font-black uppercase tracking-[0.2em] text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400">{t('noFamily.joinBody')}</p>
            <Button type="submit" fullWidth disabled={busy}>
              {busy ? t('noFamily.sending') : t('noFamily.send')}
            </Button>
            <Button type="button" fullWidth variant="ghost" disabled={busy} onClick={() => setMode('choice')}>
              {t('noFamily.back')}
            </Button>
          </form>
        )}
      </div>
    </OnboardingShell>
  );
}

export default NoFamilyChoice;
