import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Baby, PartyPopper, Rocket, Gift, ArrowRight, Check } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { useStore } from '../store/useStore';
import { createManagedMember } from '../lib/api';
import { isChildRole } from '../lib/roles';
import { AvatarPicker } from '../components/profile/AvatarPicker';
import { CreateChildLoginDialog } from '../components/family/CreateChildLoginDialog';
import {
  clearChildOnboardingStep,
  loadChildOnboardingStep,
  saveChildOnboardingStep,
} from '../lib/childOnboarding';

// Preset accent colours offered during child creation (optional field).
const COLOUR_SWATCHES = [
  { name: 'Sky', value: '#38bdf8' },
  { name: 'Violet', value: '#a78bfa' },
  { name: 'Rose', value: '#fb7185' },
  { name: 'Amber', value: '#fbbf24' },
  { name: 'Emerald', value: '#34d399' },
  { name: 'Fuchsia', value: '#e879f9' },
];

const TOTAL_STEPS = 6;

export function ChildOnboarding() {
  const { t } = useTranslation(['auth', 'common']);
  const navigate = useNavigate();
  const currentUser = useStore((state) => state.currentUser);
  const familyMembers = useStore((state) => state.familyMembers);

  const familyId = currentUser?.familyId;

  const [step, setStep] = useState<number>(() => loadChildOnboardingStep(familyId));

  // Step 2 — create child form state
  const [name, setName] = useState('');
  const [dob, setDob] = useState('');
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Step 3 — created child + login dialog
  const [createdChild, setCreatedChild] = useState<{ id: string; displayName: string } | null>(null);
  const [createLoginFor, setCreateLoginFor] = useState<{ id: string; displayName: string } | null>(null);

  // Safety net: if a child appears (e.g. created elsewhere) we leave the flow.
  useEffect(() => {
    if (familyMembers.some((m) => isChildRole(m.role))) {
      clearChildOnboardingStep(familyId);
      navigate('/', { replace: true });
    }
  }, [familyMembers, familyId, navigate]);

  // Persist the current step so a mid-flow refresh resumes safely.
  useEffect(() => {
    saveChildOnboardingStep(familyId, step);
  }, [step, familyId]);

  const goTo = (next: number) => setStep(next);

  const handleCreateChild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!familyId) return;
    if (!name.trim()) {
      setFormError(t('auth:childOnboarding.nameRequired'));
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const childId = await createManagedMember(familyId, 'child', name.trim(), {
        dob: dob || null,
        avatarId,
        colour,
      });
      setCreatedChild({ id: childId, displayName: name.trim() });
      goTo(3);
    } catch (err: any) {
      setFormError(err?.message || t('common:errorOccurred'));
    } finally {
      setSubmitting(false);
    }
  };

  const finish = () => {
    clearChildOnboardingStep(familyId);
    navigate('/', { replace: true });
  };

  const stepLabel = (current: number) =>
    t('auth:stepOf', { current, total: TOTAL_STEPS });

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        {/* Step 1 — Welcome */}
        {step === 1 && (
          <div className="bg-white p-8 rounded-xl shadow text-center">
            <div className="w-16 h-16 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Baby size={32} />
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('auth:childOnboarding.welcomeTitle')}</h2>
            <p className="text-gray-600 mb-6">{t('auth:childOnboarding.welcomeBody')}</p>
            <Button fullWidth size="lg" onClick={() => goTo(2)}>
              {t('auth:childOnboarding.addFirstChild')}
            </Button>
            <div className="pt-4">
              <button
                type="button"
                onClick={finish}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                {t('auth:childOnboarding.skipForNow')}
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Create Child */}
        {step === 2 && (
          <form className="bg-white p-8 rounded-xl shadow space-y-6" onSubmit={handleCreateChild}>
            <div className="text-center mb-2">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{stepLabel(2)}</span>
              <h3 className="text-xl font-bold mt-1">{t('auth:childOnboarding.createTitle')}</h3>
            </div>

            <div>
              <label htmlFor="child-name" className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth:childOnboarding.nameLabel')}
              </label>
              <input
                id="child-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('auth:childOnboarding.namePlaceholder')}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <label htmlFor="child-dob" className="block text-sm font-medium text-gray-700 mb-1">
                {t('auth:childOnboarding.dobLabel')}
              </label>
              <input
                id="child-dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">{t('auth:childOnboarding.avatarLabel')}</span>
              <AvatarPicker
                selectedAvatarId={avatarId}
                ownedAvatarIds={[]}
                pointsBalance={0}
                onSelect={setAvatarId}
                onRequestUnlock={() => undefined}
              />
            </div>

            <div>
              <span className="block text-sm font-medium text-gray-700 mb-2">{t('auth:childOnboarding.colourLabel')}</span>
              <div className="flex flex-wrap gap-2">
                {COLOUR_SWATCHES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-label={c.name}
                    aria-pressed={colour === c.value}
                    onClick={() => setColour(colour === c.value ? null : c.value)}
                    className={`w-9 h-9 rounded-full border-2 transition-all ${
                      colour === c.value ? 'border-gray-900 scale-110' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c.value }}
                  />
                ))}
              </div>
            </div>

            {formError && <p className="text-red-500 text-sm">{formError}</p>}

            <div className="flex gap-4 pt-2">
              <Button type="button" variant="secondary" onClick={() => goTo(1)} disabled={submitting}>
                {t('common:back')}
              </Button>
              <Button type="submit" className="flex-1" disabled={submitting}>
                {submitting ? t('common:loading') : t('auth:childOnboarding.createChild')}
              </Button>
            </div>
          </form>
        )}

        {/* Step 3 — Success + login offer */}
        {step === 3 && createdChild && (
          <div className="bg-white p-8 rounded-xl shadow text-center space-y-6">
            <div className="w-16 h-16 bg-success-100 text-success-600 rounded-full flex items-center justify-center mx-auto">
              <PartyPopper size={32} />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">{t('auth:childOnboarding.successTitle')}</h3>
              <p className="text-gray-600 mt-1">{t('auth:childOnboarding.successBody', { name: createdChild.displayName })}</p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 text-left">
              <div className="flex items-center gap-3">
                <Avatar src="" fallback={createdChild.displayName[0]} />
                <div>
                  <p className="font-semibold text-gray-900">{createdChild.displayName}</p>
                  <p className="text-sm text-gray-500">{t('auth:child')}</p>
                </div>
              </div>
            </div>

            <p className="text-gray-700 font-medium">{t('auth:childOnboarding.createLoginQuestion')}</p>

            <div className="flex flex-col gap-3">
              <Button fullWidth onClick={() => setCreateLoginFor(createdChild)}>
                {t('auth:childOnboarding.createLogin')}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => goTo(4)}>
                {t('auth:childOnboarding.skipLogin')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4 — Quick Start (task) */}
        {step === 4 && (
          <div className="bg-white p-8 rounded-xl shadow text-center space-y-6">
            <div className="w-16 h-16 bg-primary-100 text-primary-600 rounded-full flex items-center justify-center mx-auto">
              <Rocket size={32} />
            </div>
            <div>
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{stepLabel(4)}</span>
              <h3 className="text-xl font-bold text-gray-900 mt-1">{t('auth:childOnboarding.quickStartTitle')}</h3>
              <p className="text-gray-600 mt-1">{t('auth:childOnboarding.quickStartBody')}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button fullWidth onClick={() => navigate('/tasks')}>
                {t('auth:childOnboarding.createFirstTask')}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => goTo(5)}>
                {t('auth:childOnboarding.skip')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 5 — Rewards */}
        {step === 5 && (
          <div className="bg-white p-8 rounded-xl shadow text-center space-y-6">
            <div className="w-16 h-16 bg-reward-100 text-reward-600 rounded-full flex items-center justify-center mx-auto">
              <Gift size={32} />
            </div>
            <div>
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{stepLabel(5)}</span>
              <h3 className="text-xl font-bold text-gray-900 mt-1">{t('auth:childOnboarding.rewardsTitle')}</h3>
              <p className="text-gray-600 mt-1">{t('auth:childOnboarding.rewardsBody')}</p>
            </div>
            <div className="flex flex-col gap-3">
              <Button fullWidth onClick={() => navigate('/rewards')}>
                {t('auth:childOnboarding.createFirstReward')}
              </Button>
              <Button variant="secondary" fullWidth onClick={() => goTo(6)}>
                {t('auth:childOnboarding.skip')}
              </Button>
            </div>
          </div>
        )}

        {/* Step 6 — Finish */}
        {step === 6 && (
          <div className="bg-white p-8 rounded-xl shadow text-center space-y-6">
            <div className="w-16 h-16 bg-success-100 text-success-600 rounded-full flex items-center justify-center mx-auto">
              <Check size={32} />
            </div>
            <div>
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">{stepLabel(6)}</span>
              <h3 className="text-xl font-bold text-gray-900 mt-1">{t('auth:childOnboarding.finishTitle')}</h3>
              <p className="text-gray-600 mt-1">{t('auth:childOnboarding.finishBody')}</p>
            </div>
            <Button fullWidth size="lg" onClick={finish}>
              <span className="inline-flex items-center gap-2">
                {t('auth:childOnboarding.goToDashboard')}
                <ArrowRight size={18} />
              </span>
            </Button>
          </div>
        )}
      </div>

      {/* Reused existing Child Login dialog (Step 3) */}
      {createLoginFor && (
        <CreateChildLoginDialog
          member={createLoginFor}
          onClose={() => {
            setCreateLoginFor(null);
            goTo(4);
          }}
          onSuccess={() => {
            setCreateLoginFor(null);
            goTo(4);
          }}
        />
      )}
    </div>
  );
}
