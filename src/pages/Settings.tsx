import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import {
  User,
  Users,
  Bell,
  Shield,
  Info,
  Copy,
  RefreshCw,
  LogOut,
  KeyRound,
  CheckCircle2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  signOut,
  sendPasswordReset,
  getAuthProviderInfo,
  mapAuthErrorMessage,
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
  const config = {
    connecting: { label: 'Connecting…', Icon: Loader2, tone: 'text-amber-600', bg: 'bg-amber-100', spin: true },
    connected: { label: 'Connected', Icon: CheckCircle2, tone: 'text-green-600', bg: 'bg-green-100', spin: false },
    unavailable: { label: 'Temporarily unavailable', Icon: AlertTriangle, tone: 'text-red-600', bg: 'bg-red-100', spin: false },
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
            <p className="text-sm font-semibold text-gray-900">Notification Center</p>
            <p className="text-xs text-gray-500">Real-time connection status</p>
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
          Retry connection
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
        <h3 className="text-sm font-semibold text-gray-900">Push notifications</h3>
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500">
          <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Checking…
        </div>
      </div>
    );
  }

  const { support, status, error, lastRegisteredAt } = state;

  if (support === 'unsupported') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Push notifications</h3>
        <span className="mt-2 inline-flex items-center rounded-full bg-gray-100 text-gray-500 px-2 py-0.5 text-xs font-semibold">
          Not supported on this browser
        </span>
        <p className="mt-2 text-sm text-gray-600">
          This browser or device does not support FamilyQuest push notifications.
        </p>
      </div>
    );
  }

  if (status === 'blocked') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Push notifications</h3>
        <span className="mt-2 inline-flex items-center rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-semibold">
          Blocked in browser settings
        </span>
        <p className="mt-2 text-sm text-gray-600">
          Notifications are blocked. Enable them in your browser or device settings, then return here.
        </p>
      </div>
    );
  }

  if (status === 'enabled') {
    return (
      <div className="pt-3 border-t border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">Push notifications</h3>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div>
            <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
              Enabled on this device
            </span>
            {lastRegisteredAt ? (
              <p className="mt-1 text-xs text-gray-400">
                Last registered {new Date(lastRegisteredAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <Button variant="secondary" size="sm" onClick={onDisable} disabled={busy}>
            Disable on this device
          </Button>
        </div>
        <p className="mt-2 text-sm text-gray-600">
          You'll receive FamilyQuest updates on this device even when the app is not open.
        </p>
      </div>
    );
  }

  // not_enabled or unavailable
  const isUnavailable = status === 'unavailable';
  return (
    <div className="pt-3 border-t border-gray-100">
      <h3 className="text-sm font-semibold text-gray-900">Push notifications</h3>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            isUnavailable ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isUnavailable ? 'Temporarily unavailable' : 'Not enabled'}
        </span>
        <Button variant="primary" size="sm" onClick={onEnable} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          ) : isUnavailable ? (
            'Try again'
          ) : (
            'Enable push notifications'
          )}
        </Button>
      </div>
      <p className="mt-2 text-sm text-gray-600">
        {isUnavailable && error
          ? error
          : 'Receive FamilyQuest updates even when the app is not open.'}
      </p>
    </div>
  );
}

export function Settings() {
  const currentUser = useStore(state => state.currentUser);
  const authUser = useStore(state => state.authUser);
  const familyData = useStore(state => state.familyData);
  const familyMembers = useStore(state => state.familyMembers);

  const [editorOpen, setEditorOpen] = useState(false);

  // Global status (copy, etc.)
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Invite code copy
  const [copying, setCopying] = useState(false);

  // Password reset
  const [resetState, setResetState] = useState<{
    loading: boolean;
    message: { type: 'success' | 'error'; text: string } | null;
  }>({ loading: false, message: null });

  const role = currentUser?.role;
  const owner = isOwnerRole(role);
  const child = isChildRole(role);
  const isParentOrOwner = isOwnerRole(role) || isParentRole(role);
  const profileUpdateRequests = useStore(state => state.profileUpdateRequests);
  const pendingProfileUpdate = child
    ? profileUpdateRequests.find(r => r.childId === currentUser?.id && r.status === 'pending')
    : undefined;
  const roleNotificationCopy = isParentOrOwner
    ? 'Approval requests — tasks, reward requests, and transfers — appear in your notification center.'
    : 'Task results, wallet changes, transfers, and behaviour updates appear in your notification center.';
  const { connectionState, retry } = useNotifications(currentUser?.familyId ?? null, currentUser?.uid ?? null);

  const inviteCode = familyData?.inviteCode;
  const memberCount = familyMembers?.length ?? 0;

  const handleCopy = async () => {
    if (!inviteCode || copying) return;
    setCopying(true);
    setStatus(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteCode);
      } else {
        throw new Error('Clipboard unavailable');
      }
      setStatus({ type: 'success', message: 'Invite code copied to clipboard.' });
    } catch {
      setStatus({ type: 'error', message: 'Could not copy the invite code. Please try again.' });
    } finally {
      setCopying(false);
    }
  };

  const handlePasswordReset = async () => {
    if (resetState.loading) return;
    const email = authUser?.email ?? currentUser?.email;
    if (!email) {
      setResetState(s => ({ ...s, message: { type: 'error', text: 'No email is associated with this account.' } }));
      return;
    }
    setResetState({ loading: true, message: null });
    try {
      await sendPasswordReset(email);
      setResetState({
        loading: false,
        message: { type: 'success', text: `We sent a password reset link to ${email}.` },
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
      setStatus({ type: 'error', message: 'Could not sign out. Please try again.' });
    }
  };

  const providerInfo = getAuthProviderInfo();
  const canResetPassword = providerInfo.isEmailPassword;

  const notificationCategories = [
    'Task updates',
    'Reward requests',
    'Wallet updates',
    'Transfer updates',
    'Behaviour updates',
    'Pet Box updates',
  ];

  const buildTimestamp = (() => {
    const date = new Date(FAMILYQUEST_BUILD.builtAt);
    return Number.isNaN(date.getTime()) ? FAMILYQUEST_BUILD.builtAt : date.toLocaleString();
  })();

  const environment = (import.meta.env.MODE || 'development').toUpperCase();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your profile, family and account.</p>
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
        title="Profile"
        description="Your personal information and how you appear to the family."
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
                Edit Profile
              </Button>
              <Button variant="secondary" onClick={() => setEditorOpen(true)} className="flex-1">
                Change Avatar
              </Button>
            </div>
            {child && pendingProfileUpdate && (
              <p className="mt-3 text-xs text-blue-700" role="status">
                You have a pending profile update awaiting parent approval.
              </p>
            )}
            {child && !pendingProfileUpdate && (
              <p className="mt-3 text-xs text-amber-700">
                Profile changes are sent to a parent for approval before they take effect.
              </p>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* 2. FAMILY */}
      <Section
        id="family-section"
        icon={Users}
        title="Family"
        description="Family details and member management."
      >
        <Card>
          <CardContent className="p-5 divide-y divide-gray-100">
            <Row label="Family name" value={familyData?.name ?? '—'} />

            {child ? (
              <div className="pt-3">
                <p className="text-sm font-medium text-gray-500 mb-2">Family members</p>
                <ul className="space-y-2">
                  {familyMembers.map(member => (
                    <li key={member.id} className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-900 truncate">
                        {member.displayName}
                      </span>
                      <span className="text-xs font-medium text-gray-400">
                        {getRoleLabel(member.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <>
                <div className="py-3">
                  <p className="text-sm font-medium text-gray-500 mb-2">Invite code</p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                      <span className="font-mono text-lg font-bold tracking-widest text-primary-600">
                        {inviteCode || '—'}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        onClick={handleCopy}
                        disabled={copying || !inviteCode}
                        aria-label="Copy invite code"
                        className="flex-1 sm:flex-none justify-center"
                      >
                        {copying ? (
                          'Copying…'
                        ) : (
                          <>
                            <Copy size={16} className="mr-2" aria-hidden="true" /> Copy
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>

                {owner && (
                  <div className="py-3">
                    <Button
                      variant="outline"
                      disabled
                      aria-label="Regenerate invite code"
                      className="w-full justify-center cursor-not-allowed"
                      title="Regenerate invite code is not available yet"
                    >
                      <RefreshCw size={16} className="mr-2" aria-hidden="true" /> Regenerate invite code
                    </Button>
                    <p className="mt-2 text-xs text-gray-400">
                      Regenerating the invite code is not available yet. This action will
                      invalidate the old code once enabled.
                    </p>
                  </div>
                )}

                <Row label="Member count" value={memberCount} />
              </>
            )}
          </CardContent>
        </Card>
      </Section>

      {/* 3. NOTIFICATIONS */}
      <Section
        id="notifications-section"
        icon={Bell}
        title="Notifications"
        description="How FamilyQuest keeps you informed."
      >
        <Card>
          <CardContent className="p-5 space-y-4">
            {/* In-app notifications: real capability only */}
            <div>
              <h3 className="text-sm font-semibold text-gray-900">In-app notifications</h3>
              <div className="mt-2">
                <span className="inline-flex items-center rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-semibold">
                  Active
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">
                Notifications appear in FamilyQuest while you are signed in.
              </p>
            </div>

            {/* Supported categories (informational rows, no toggles) */}
            <div className="pt-3 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Notification categories</h3>
              <ul className="mt-2 space-y-1">
                {notificationCategories.map(category => (
                  <li key={category} className="flex items-center gap-2 text-sm text-gray-700">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary-400" aria-hidden="true" />
                    {category}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-400">
                These categories are delivered as in-app notifications. Per-category preferences are
                not available yet.
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

      {/* 4. SECURITY */}
      <Section
        id="security-section"
        icon={Shield}
        title="Security"
        description="Account access and sign-out."
      >
        <Card>
          <CardContent className="p-5 space-y-4">
            {canResetPassword ? (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">Change password</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    We'll email you a secure link to reset your password.
                  </p>
                </div>
                <Button
                  onClick={handlePasswordReset}
                  disabled={resetState.loading}
                  aria-label="Send password reset email"
                  className="w-full sm:w-auto"
                >
                  <KeyRound size={16} className="mr-2" aria-hidden="true" />
                  {resetState.loading ? 'Sending…' : 'Send password reset email'}
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
                  <h3 className="text-sm font-semibold text-gray-900">Password</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {providerInfo.primaryProviderLabel
                      ? `You sign in with ${providerInfo.primaryProviderLabel}. To change your password, manage it through your ${providerInfo.primaryProviderLabel} account.`
                      : 'Password changes are managed through your sign-in provider.'}
                  </p>
                </div>
              </div>
            )}

            <div className="pt-2 border-t border-gray-50">
              <Button
                variant="danger"
                onClick={handleSignOut}
                aria-label="Sign Out"
                className="w-full sm:w-auto"
              >
                <LogOut size={18} className="mr-2" aria-hidden="true" /> Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </Section>

      {/* 5. ABOUT */}
      <Section
        id="about-section"
        icon={Info}
        title="About"
        description="App and build information."
      >
        <Card>
          <CardContent className="p-5 divide-y divide-gray-100">
            <Row label="App version" value={FAMILYQUEST_BUILD.version} />
            <Row label="Build commit" value={FAMILYQUEST_BUILD.sha.slice(0, 7)} />
            <Row label="Build timestamp" value={buildTimestamp} />
            <Row label="Environment" value={environment} />
            <Row label="Firebase project" value={projectId ?? '—'} />
          </CardContent>
        </Card>
      </Section>

      {editorOpen && currentUser && (
        <ProfileEditorModal user={currentUser} onClose={() => setEditorOpen(false)} />
      )}
    </div>
  );
}
