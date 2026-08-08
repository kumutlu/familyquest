import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { formatDate } from '../i18n/format';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import {
  User,
  Users,
  Bell,
  Shield,
  Info,
  LogOut,
  KeyRound,
  CheckCircle2,
  Loader2,
  AlertTriangle,
  Globe,
} from 'lucide-react';
import i18n, {
  applyLanguage,
  isSupportedLanguage,
  resolveProfileLanguage,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '../i18n';
import {
  signOut,
  sendPasswordReset,
  getAuthProviderInfo,
  mapAuthErrorMessage,
  updateLanguagePreference,
} from '../lib/api';
import { useStore } from '../store/useStore';
import {
  isOwnerRole,
  isChildRole,
  isParentRole,
  getRoleLabel,
} from '../lib/roles';
import { useNotifications, type NotificationConnectionState } from '../lib/useNotifications';
import {
  loadPushState,
  registerCurrentDevice,
  unregisterCurrentDevice,
  type PushState,
} from '../lib/pushNotifications';
import { FAMILYQUEST_BUILD } from '../buildInfo';
import { ProfileEditorModal } from '../components/profile/ProfileEditorModal';
import { FamilySettings } from '../components/family/FamilySettings';
import { DeleteAccountDialog } from '../components/settings/DeleteAccountDialog';
import { getLegalLinks } from '../config/legalLinks';

interface SectionProps {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}

function Section({ id, icon: Icon, title, description, children }: SectionProps) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <div className="px-1">
        <h2 id={id} className="text-lg font-bold text-gray-900 flex items-center gap-2">
          <Icon size={18} className="text-primary-500" aria-hidden="true" />
          {title}
        </h2>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm font-medium text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900 text-right truncate">{value}</span>
    </div>
  );
}

/**
 * Non-interactive real-time connection status for the notification center.
 * Status is conveyed by both an icon and a text label (never colour alone).
 * A Retry button is shown only in the unavailable state, and only because the
 * underlying hook supports safe resubscription. Firestore error codes are
 * never surfaced here — the user only sees the friendly state label.
 */
function NotificationHealth({
  state,
  onRetry,
}: {
  state: NotificationConnectionState;
  onRetry: () => void;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const config = {
    connecting: { label: t('healthConnecting'), Icon: Loader2, tone: 'text-amber-600', bg: 'bg-amber-100', spin: true },
    connected: { label: t('healthConnected'), Icon: CheckCircle2, tone: 'text-green-600', bg: 'bg-green-100', spin: false },
    unavailable: { label: t('common:unavailable'), Icon: AlertTriangle, tone: 'text-red-600', bg: 'bg-red-100', spin: false },
  } as const;
  const { label, Icon, tone, bg, spin } = config[state];
  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex items-center justify-center w-6 h-6 rounded-full ${bg}`} aria-hidden="true">
            <Icon size={14} className={spin ? 'animate-spin' : ''} />
          </span>
          <div>
            <p className="text-sm font-semibold text-gray-900">{t('healthTitle')}</p>
            <p className="text-xs text-gray-500">{t('healthSubtitle')}</p>
          </div>
        </div>
        <span className={`text-xs font-semibold ${tone}`}>{label}</span>
      </div>
      {/* Polite live region so screen readers hear state changes once, not on every count update. */}
      <div aria-live="polite" className="sr-only">{label}</div>
      {state === 'unavailable' && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 w-full text-center text-xs font-semibold text-primary-600 hover:text-primary-700 py-2 rounded-lg border border-primary-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          {t('healthRetry')}
        </button>
      )}
    </div>
  );
}

/**
 * Push-notification settings. Permission is only ever requested from the
 * Enable button (a user gesture) — never automatically. State is per device.
 */
function PushNotificationsSection({
  familyId,
  userId,
}: {
  familyId: string | null;
  userId: string | null;
}) {
  const { t } = useTranslation(['settings', 'common']);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setState(await loadPushState(familyId, userId));
  }, [familyId, userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onEnable = async () => {
    if (!familyId || !userId) return;
    setBusy(true);
    try {
      setState(await registerCurrentDevice(familyId, userId));
    } finally {
      setBusy(false);
    }
  };

  const onDisable = async () => {
    if (!familyId || !userId) return;
    setBusy(true);
    try {
      await unregisterCurrentDevice(familyId, userId);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{t('pushTitle')}</h3>
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> {t('pushChecking')}
        </div>
      </div>
    );
  }

  const { support, status, error, lastRegisteredAt } = state;

  if (support === 'unsupported') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{t('pushTitle')}</h3>
        <span className="mt-2 inline-flex items-center rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-semibold">
          {t('pushUnsupported')}
        </span>
        <p className="mt-2 text-sm text-gray-600">
          {t('pushUnsupportedDesc')}
        </p>
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{t('pushTitle')}</h3>
        <span className="mt-2 inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">
          {t('pushBlocked')}
        </span>
        <p className="mt-2 text-sm text-gray-600">
          {t('pushBlockedDesc')}
        </p>
      </div>
    );
  }

  if (status === 'enabled') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{t('pushTitle')}</h3>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
              {t('pushEnabled')}
            </span>
            {lastRegisteredAt ? (
              <p className="mt-1 text-xs text-gray-400">
                {t('pushLastRegistered', { date: formatDate(new Date(lastRegisteredAt)) })}
              </p>
            ) : null}
          </div>
          <Button variant="secondary" size="sm" onClick={onDisable} disabled={busy}>
            {t('pushDisable')}
          </Button>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          {t('pushEnabledDesc')}
        </p>
      </div>
    );
  }

  // not_enabled or unavailable
  const isUnavailable = status === 'unavailable';
  return (
    <div className="pt-3 border-t border-gray-100">
      <h3 className="text-sm font-semibold text-gray-900">{t('pushTitle')}</h3>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            isUnavailable ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isUnavailable ? t('common:unavailable') : t('pushNotEnabled')}
        </span>
        <Button variant="primary" size="sm" onClick={onEnable} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : isUnavailable ? (
            t('common:tryAgain')
          ) : (
            t('pushEnable')
          )}
        </Button>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {isUnavailable && error
          ? error
          : t('pushEnabledDesc')}
      </p>
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation(['settings', 'notifications', 'common']);
  const currentUser = useStore(state => state.currentUser);
  const authUser = useStore(state => state.authUser);
  const familyData = useStore(state => state.familyData);

  const [editorOpen, setEditorOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const legalLinks = getLegalLinks();

  // Sign-out status is surfaced at page level; family actions own their feedback.
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Password reset
  const [resetState, setResetState] = useState<{
    loading: boolean;
    message: { type: 'success' | 'error'; text: string } | null;
  }>({ loading: false, message: null });

  const role = currentUser?.role;
  const child = isChildRole(role);
  const isParentOrOwner = isOwnerRole(role) || isParentRole(role);
  const profileUpdateRequests = useStore(state => state.profileUpdateRequests);
  const pendingProfileUpdate = child
    ? profileUpdateRequests.find(r => r.childId === currentUser?.id && r.status === 'pending')
    : undefined;
  const roleNotificationCopy = isParentOrOwner
    ? t('roleCopyParent')
    : t('roleCopyChild');
  const { connectionState, retry } = useNotifications(currentUser?.familyId ?? null, currentUser?.id ?? null);

  const handlePasswordReset = async () => {
    if (resetState.loading) return;
    const email = authUser?.email ?? currentUser?.email;
    if (!email) {
      setResetState(s => ({ ...s, message: { type: 'error', text: t('noEmail') } }));
      return;
    }
    setResetState({ loading: true, message: null });
    try {
      await sendPasswordReset(email);
      setResetState({
        loading: false,
        message: { type: 'success', text: t('resetSent', { email }) },
      });
    } catch (err) {
      setResetState({
        loading: false,
        message: { type: 'error', text: mapAuthErrorMessage(err) },
      });
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch {
      setStatus({ type: 'error', message: t('statusSignOutFailed') });
    }
  };

  const providerInfo = getAuthProviderInfo();
  const canResetPassword = providerInfo.isEmailPassword;

  const language = isSupportedLanguage(currentUser?.language)
    ? currentUser.language
    : resolveProfileLanguage(currentUser?.language);

  const handleLanguageChange = async (lang: SupportedLanguage) => {
    if (!isSupportedLanguage(lang) || !currentUser || lang === language) return;
    const previousLanguage = language;
    const previousUser = currentUser;
    useStore.setState({ currentUser: { ...currentUser, language: lang } });
    await applyLanguage(lang);
    try {
      await updateLanguagePreference(lang);
      setStatus({ type: 'success', message: i18n.t('settings:languageSaved') });
    } catch (error) {
      console.error('Failed to persist language preference', error);
      if (useStore.getState().currentUser?.language === lang) {
        useStore.setState({ currentUser: { ...previousUser, language: previousLanguage } });
        await applyLanguage(previousLanguage);
      }
      setStatus({ type: 'error', message: i18n.t('settings:languageSaveFailed') });
    }
  };

  const notificationCategories = [
    t('categories.taskUpdates'),
    t('categories.rewardRequests'),
    t('categories.walletUpdates'),
    t('categories.transferUpdates'),
    t('categories.behaviourUpdates'),
    t('categories.petBoxUpdates'),
  ];

  // The raw build timestamp is stored as ISO; it is localised only here, for
  // display, using the active app language (date + time).
  const buildTimestamp = (() => {
    const date = new Date(FAMILYQUEST_BUILD.builtAt);
    return Number.isNaN(date.getTime())
      ? FAMILYQUEST_BUILD.builtAt
      : formatDate(date, undefined, {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
  })();

  const environment = FAMILYQUEST_BUILD.environment;
  const projectId = FAMILYQUEST_BUILD.firebaseProjectId;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <div className="flex items-center gap-1">
          <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
          <HelpButton />
        </div>
        <p className="text-sm text-gray-500 mt-1">{t('subtitle')}</p>
      </header>

      {/* Global status region */}
      <div aria-live="polite" aria-atomic="true">
        {status && (
          <div
            role={status.type === 'error' ? 'alert' : 'status'}
            className={`p-3 rounded-xl text-sm font-medium ${
              status.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-600 border border-red-200'
            }`}
          >
            {status.message}
          </div>
        )}
      </div>

      {/* 1. PROFILE */}
      <Section
        id="profile-section"
        icon={User}
        title={t('profile')}
        description={t('profileDesc')}
      >
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <Avatar
                src={currentUser?.avatarUrl}
                fallback={(currentUser?.displayName?.[0] ?? '?').toUpperCase()}
                size="lg"
              />
              <div className="min-w-0">
                <p className="text-lg font-bold text-gray-900 truncate">{currentUser?.displayName}</p>
                <p className="text-sm text-gray-500 truncate">{currentUser?.email ?? authUser?.email}</p>
                <p className="text-xs font-semibold text-primary-600 mt-0.5">{getRoleLabel(role)}</p>
              </div>
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-3">
              <Button onClick={() => setEditorOpen(true)} className="flex-1">
                {t('editProfile')}
              </Button>
              <Button variant="secondary" onClick={() => setEditorOpen(true)} className="flex-1">
                {t('changeAvatar')}
              </Button>
            </div>
            {child && pendingProfileUpdate && (
              <p className="mt-3 text-xs text-blue-700" role="status">
                {t('pendingProfileUpdate')}
              </p>
            )}
            {child && !pendingProfileUpdate && (
              <p className="mt-3 text-xs text-amber-700">
                {t('profileApprovalNote')}
              </p>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* 2. FAMILY */}
      <Section
        id="family-section"
        icon={Users}
        title={t('familyTitle')}
        description={t('familyDesc')}
      >
        <FamilySettings />
      </Section>

      {/* 3. NOTIFICATIONS */}
      <Section
        id="notifications-section"
        icon={Bell}
        title={t('notificationsTitle')}
        description={t('notificationsDesc')}
      >
        <Card>
          <CardContent className="p-5 space-y-4">
            {/* In-app notifications: real capability only */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{t('inAppTitle')}</h3>
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
                  {t('common:active')}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {t('inAppDesc')}
              </p>
            </div>

            {/* Supported categories (informational rows, no toggles) */}
            <div className="pt-3 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">{t('categoriesTitle')}</h3>
              <ul className="mt-2 space-y-1">
                {notificationCategories.map(category => (
                  <li key={category} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-400" aria-hidden="true" />
                    {category}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">
                {t('categoriesNote')}
              </p>
            </div>

            {/* Push notifications: dynamic, per-device, opt-in only */}
            <PushNotificationsSection
              familyId={familyData?.id ?? null}
              userId={currentUser?.id ?? null}
            />

            {/* Role-specific explanation (central role helpers) */}
            <div className="pt-3 border-t border-gray-100">
              <p className="text-sm text-gray-600">{roleNotificationCopy}</p>
            </div>

            {/* Real-time connection health (status only, non-interactive except retry) */}
            <NotificationHealth state={connectionState} onRetry={retry} />
          </CardContent>
        </Card>
      </Section>

      {/* 3.5 LANGUAGE */}
      <Section
        id="language-section"
        icon={Globe}
        title={t('languageTitle')}
        description={t('languageDesc')}
      >
        <Card>
          <CardContent className="p-5 space-y-2">
            {SUPPORTED_LANGUAGES.map(lang => (
              <label
                key={lang}
                className={`flex items-center gap-3 rounded-lg border px-4 py-3 cursor-pointer ${
                  language === lang ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
                }`}
              >
                <input
                  type="radio"
                  name="language"
                  value={lang}
                  checked={language === lang}
                  onChange={() => handleLanguageChange(lang as SupportedLanguage)}
                  className="accent-primary-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  {lang === 'en' ? t('english') : t('turkish')}
                </span>
              </label>
            ))}
          </CardContent>
        </Card>
      </Section>

      {/* 4. SECURITY */}
      <Section
        id="security-section"
        icon={Shield}
        title={t('securityTitle')}
        description={t('securityDesc')}
      >
        <Card>
          <CardContent className="p-5 space-y-4">
            {canResetPassword ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{t('changePassword')}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {t('changePasswordDesc')}
                  </p>
                </div>
                <Button
                  onClick={handlePasswordReset}
                  disabled={resetState.loading}
                  aria-label={t('sendResetAria')}
                  className="w-full sm:w-auto"
                >
                  <KeyRound size={16} className="mr-2" aria-hidden="true" />
                  {resetState.loading ? t('common:sending') : t('sendReset')}
                </Button>
                <div aria-live="polite" aria-atomic="true">
                  {resetState.message && (
                    <p
                      role={resetState.message.type === 'error' ? 'alert' : 'status'}
                      className={
                        resetState.message.type === 'success'
                          ? 'text-sm font-medium text-green-700'
                          : 'text-sm font-medium text-red-600'
                      }
                    >
                      {resetState.message.text}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <KeyRound size={18} className="mt-0.5 text-gray-400" aria-hidden="true" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{t('password')}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {providerInfo.primaryProviderLabel
                      ? t('passwordProvider', { provider: providerInfo.primaryProviderLabel })
                      : t('passwordProviderDefault')}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-gray-50 space-y-4">
              <Button
                variant="danger"
                onClick={handleSignOut}
                aria-label={t('signOutAria')}
                className="w-full sm:w-auto"
              >
                <LogOut size={18} className="mr-2" aria-hidden="true" /> {t('signOut')}
              </Button>
              {!currentUser?.isManaged && (
                <div className="pt-2 border-t border-gray-50">
                  <h3 className="text-sm font-semibold text-red-700">{t('deleteAccount.title')}</h3>
                  <p className="text-sm text-gray-500 mt-1 mb-3">{t('deleteAccount.settingsDesc')}</p>
                  <Button
                    variant="outline"
                    onClick={() => setDeleteAccountOpen(true)}
                    aria-label={t('deleteAccount.openAria')}
                    data-testid="open-delete-account"
                    className="w-full sm:w-auto border-red-300 text-red-700 hover:bg-red-50"
                  >
                    <AlertTriangle size={18} className="mr-2" aria-hidden="true" /> {t('deleteAccount.action')}
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 5. ABOUT */}
      <Section
        id="about-section"
        icon={Info}
        title={t('aboutTitle')}
        description={t('aboutDesc')}
      >
        <Card>
          <CardContent className="p-5 divide-y divide-gray-100">
            <Row label={t('appVersion')} value={FAMILYQUEST_BUILD.version} />
            <Row label={t('buildCommit')} value={FAMILYQUEST_BUILD.sha} />
            <Row label={t('buildTimestamp')} value={buildTimestamp} />
            <Row label={t('environment')} value={environment} />
            <Row label={t('firebaseProject')} value={projectId} />
            {(legalLinks.privacyPolicy || legalLinks.terms || legalLinks.accountDeletion) && (
              <nav aria-label={t('legalLinksAria')} className="pt-3 flex flex-col gap-2">
                {legalLinks.privacyPolicy && (
                  <a
                    href={legalLinks.privacyPolicy}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="legal-privacy-policy"
                    className="text-sm text-primary-600 underline"
                  >
                    {t('privacyPolicy')}
                  </a>
                )}
                {legalLinks.terms && (
                  <a
                    href={legalLinks.terms}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="legal-terms"
                    className="text-sm text-primary-600 underline"
                  >
                    {t('termsOfService')}
                  </a>
                )}
                {legalLinks.accountDeletion && (
                  <a
                    href={legalLinks.accountDeletion}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="legal-account-deletion"
                    className="text-sm text-primary-600 underline"
                  >
                    {t('accountDeletionPolicy')}
                  </a>
                )}
              </nav>
            )}
          </CardContent>
        </Card>
      </Section>

      {editorOpen && currentUser && (
        <ProfileEditorModal user={currentUser} onClose={() => setEditorOpen(false)} />
      )}

      {deleteAccountOpen && (
        <DeleteAccountDialog onClose={() => setDeleteAccountOpen(false)} />
      )}
    </div>
  );
}
