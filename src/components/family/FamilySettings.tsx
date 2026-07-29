import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { Avatar } from '../ui/Avatar';
import { Users, Globe, AlertTriangle, Copy, Save, Edit, CheckCircle, Loader2, Shield } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { isOwnerRole, isParentRole, isChildRole } from '../../lib/roles';
import { getRoleLabel } from '../../lib/roles';
import { updateFamilySettings, regenerateInviteCode, approveJoinRequest, rejectJoinRequest } from '../../lib/api';
import { resolveFamilyCurrencyCode, type SupportedCurrencyCode } from '../../i18n/format';
import { Toast, type ToastData } from '../ui/Toast';
import { AddChildModal } from './AddChildModal';
import { EditMemberModal } from './EditMemberModal';
import { getTimezoneOptions } from '../../lib/timezones';
import { isPetBoxEnabled } from '../../lib/familyFeatures';

interface FamilySettingsProps {
  onSectionChange?: (section: string) => void;
}

const CURRENCY_OPTIONS = [
  { code: 'GBP', labelKey: 'familySettings.currencies.gbp' },
  { code: 'EUR', labelKey: 'familySettings.currencies.eur' },
  { code: 'USD', labelKey: 'familySettings.currencies.usd' },
  { code: 'TRY', labelKey: 'familySettings.currencies.try' },
] as const satisfies readonly { code: SupportedCurrencyCode; labelKey: string }[];

const WEEK_START_OPTIONS = [
  { value: 1, labelKey: 'familySettings.weekDays.monday' },
  { value: 0, labelKey: 'familySettings.weekDays.sunday' },
] as const;

export function FamilySettings({ onSectionChange }: FamilySettingsProps) {
  const { t, i18n } = useTranslation(['settings', 'family', 'common']);
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);
  const familyMembers = useStore(state => state.familyMembers);
  const joinRequests = useStore(state => state.joinRequests);
  const loading = useStore(state => state.familyLoading);
  const resolvedCurrencyCode = resolveFamilyCurrencyCode(familyData);
  const [searchParams] = useSearchParams();

  const [activeSection, setActiveSection] = useState(() =>
    searchParams.get('familySection') === 'members' ? 'members' : 'family');
  const [familyName, setFamilyName] = useState(familyData?.name || '');
  const [isEditingName, setIsEditingName] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [copyingInviteCode, setCopyingInviteCode] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [toast, setToast] = useState<ToastData | null>(null);
  const [showAddChildModal, setShowAddChildModal] = useState(false);
  const [showAdultInvite, setShowAdultInvite] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [approvalRoles, setApprovalRoles] = useState<Record<string, 'child' | 'parent'>>({});

  // Regional settings state
  const [regionalSettings, setRegionalSettings] = useState({
    currencyCode: resolvedCurrencyCode,
    timezone: familyData?.timezone || 'Europe/London',
    weekStartsOn: familyData?.weekStartsOn ?? 1,
  });
  const [isSavingRegional, setIsSavingRegional] = useState(false);
  const [regionalError, setRegionalError] = useState<string | null>(null);

  // Gamification settings state
  const [dailyGoalPercentage, setDailyGoalPercentage] = useState(familyData?.gamificationConfig?.dailyGoalPercentage ?? 80);
  const [petBoxEnabled, setPetBoxEnabled] = useState(isPetBoxEnabled(familyData));
  const [isSavingGamification, setIsSavingGamification] = useState(false);
  const [gamificationError, setGamificationError] = useState<string | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') =>
    setToast({ id: Date.now(), message, type });

  const role = currentUser?.role;
  const owner = isOwnerRole(role);
  const isParentOrOwner = isOwnerRole(role) || isParentRole(role);

  const inviteCode = familyData?.inviteCode;
  const memberCount = familyMembers?.length ?? 0;

  // Get pending join requests (only for owners)
  const pendingJoinRequests = joinRequests?.filter(r => r.status === 'pending') || [];

  // Handle section navigation
  useEffect(() => {
    if (onSectionChange) {
      onSectionChange(activeSection);
    }
  }, [activeSection, onSectionChange]);

  // Reset family name when data changes
  useEffect(() => {
    setFamilyName(familyData?.name || '');
  }, [familyData?.name]);

  // Reset regional settings when data changes
  useEffect(() => {
    setRegionalSettings({
      currencyCode: resolvedCurrencyCode,
      timezone: familyData?.timezone || 'Europe/London',
      weekStartsOn: familyData?.weekStartsOn ?? 1,
    });
  }, [resolvedCurrencyCode, familyData?.timezone, familyData?.weekStartsOn]);

  // Reset gamification settings when data changes
  useEffect(() => {
    setDailyGoalPercentage(familyData?.gamificationConfig?.dailyGoalPercentage ?? 80);
    setPetBoxEnabled(isPetBoxEnabled(familyData));
  }, [familyData?.gamificationConfig?.dailyGoalPercentage, familyData?.petBoxEnabled]);

  const handleSaveFamilyName = async () => {
    if (!familyData?.id) return;
    if (!familyName.trim()) {
      setNameError(t('familySettings.familyNameRequired'));
      return;
    }

    if (familyName.trim() === familyData?.name) {
      setIsEditingName(false);
      return;
    }

    setIsSavingName(true);
    setNameError(null);

    try {
      await updateFamilySettings(familyData.id, { name: familyName.trim() });
      showToast(t('familySettings.familyNameSaved'));
      setIsEditingName(false);
    } catch (error: any) {
      console.error('Failed to update family name:', error);
      setNameError(error.message || t('familySettings.familyNameUpdateError'));
    } finally {
      setIsSavingName(false);
    }
  };

  const handleCopyInviteCode = async () => {
    if (!inviteCode || copyingInviteCode) return;

    setCopyingInviteCode(true);
    setCopyStatus('idle');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteCode);
        setCopyStatus('success');
      } else {
        throw new Error('Clipboard unavailable');
      }
    } catch (error) {
      console.error('Failed to copy invite code:', error);
      setCopyStatus('error');
    } finally {
      setCopyingInviteCode(false);
      setTimeout(() => setCopyStatus('idle'), 3000);
    }
  };

  const handleRegenerateInviteCode = async () => {
    if (!familyData?.id) return;

    try {
      await regenerateInviteCode(familyData.id);
      showToast(t('familySettings.inviteCodeRegenerated'));
    } catch (error: any) {
      console.error('Failed to regenerate invite code:', error);
      showToast(error.message || t('familySettings.inviteCodeRegenerateError'), 'error');
    }
  };

  const handleSaveRegionalSettings = async () => {
    if (!familyData?.id) return;

    setIsSavingRegional(true);
    setRegionalError(null);

    try {
      await updateFamilySettings(familyData.id, {
        currencyCode: regionalSettings.currencyCode,
        timezone: regionalSettings.timezone,
        weekStartsOn: regionalSettings.weekStartsOn as 0 | 1,
      });
      showToast(t('familySettings.regionalSettingsSaved'));
    } catch (error: any) {
      console.error('Failed to update regional settings:', error);
      setRegionalError(error.message || t('familySettings.regionalSettingsUpdateError'));
    } finally {
      setIsSavingRegional(false);
    }
  };

  const handleSaveGamificationSettings = async () => {
    if (!familyData?.id) return;

    setIsSavingGamification(true);
    setGamificationError(null);

    try {
      await updateFamilySettings(familyData.id, {
        gamificationConfig: {
          schemaVersion: 1,
          dailyGoalPercentage,
        },
        petBoxEnabled,
      });
      showToast(t('familySettings.gamificationSettingsSaved'));
    } catch (error: any) {
      console.error('Failed to update gamification settings:', error);
      setGamificationError(error.message || t('familySettings.gamificationSettingsUpdateError'));
    } finally {
      setIsSavingGamification(false);
    }
  };

  const handleApproveJoinRequest = async (requestId: string) => {
    if (!familyData?.id) return;
    const selectedRole = approvalRoles[requestId] ?? 'child';
    if (
      selectedRole === 'parent' &&
      !window.confirm(t('familySettings.parentApprovalWarning'))
    ) return;

    try {
      await approveJoinRequest(familyData.id, requestId, selectedRole);
      showToast(t('familySettings.joinRequestApproved'));
    } catch (error: any) {
      console.error('Failed to approve join request:', error);
      showToast(error.message || t('familySettings.approveJoinRequestError'), 'error');
    }
  };

  const handleRejectJoinRequest = async (requestId: string, reason: string) => {
    if (!familyData?.id) return;

    try {
      await rejectJoinRequest(familyData.id, requestId, reason);
      showToast(t('familySettings.joinRequestRejected'));
    } catch (error: any) {
      console.error('Failed to reject join request:', error);
      showToast(error.message || t('familySettings.rejectJoinRequestError'), 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSaveFamilyName();
    } else if (e.key === 'Escape') {
      setIsEditingName(false);
      setFamilyName(familyData?.name || '');
      setNameError(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="loading-spinner">
        <Loader2 className="h-8 w-8 text-primary-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Navigation */}
      <div className="flex flex-wrap gap-2 p-1 bg-gray-100 rounded-xl">
        <button
          onClick={() => setActiveSection('family')}
          className={
            activeSection === 'family'
              ? 'px-4 py-2 rounded-lg text-sm font-medium bg-white text-primary-600 shadow-sm'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900'
          }
        >
          {t('familySettings.family')}
        </button>
        <button
          onClick={() => setActiveSection('members')}
          className={
            activeSection === 'members'
              ? 'px-4 py-2 rounded-lg text-sm font-medium bg-white text-primary-600 shadow-sm'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900'
          }
        >
          {t('familySettings.members')}
        </button>
        <button
          onClick={() => setActiveSection('regional')}
          className={
            activeSection === 'regional'
              ? 'px-4 py-2 rounded-lg text-sm font-medium bg-white text-primary-600 shadow-sm'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900'
          }
        >
          {t('familySettings.regional')}
        </button>
        <button
          onClick={() => setActiveSection('gamification')}
          className={
            activeSection === 'gamification'
              ? 'px-4 py-2 rounded-lg text-sm font-medium bg-white text-primary-600 shadow-sm'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900'
          }
        >
          {t('familySettings.gamification')}
        </button>
        <button
          onClick={() => setActiveSection('danger')}
          className={
            activeSection === 'danger'
              ? 'px-4 py-2 rounded-lg text-sm font-medium bg-white text-primary-600 shadow-sm'
              : 'px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900'
          }
        >
          {t('familySettings.dangerZone')}
        </button>
      </div>

      {/* Family Section */}
      {activeSection === 'family' && (
        <div className="space-y-6">
          <Section
            id="family-settings-family-section"
            icon={Users}
            title={t('familySettings.family')}
            description={t('familySettings.familyDesc')}
          >
            <Card>
              <CardContent className="p-6 divide-y divide-gray-100">
                {/* Family Name Row */}
                <div className="py-3">
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    {t('familySettings.familyName')}
                  </label>
                  {isEditingName ? (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={familyName}
                        onChange={(e) => setFamilyName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                        placeholder={t('familySettings.familyNamePlaceholder')}
                        disabled={isSavingName}
                        autoFocus
                      />
                      {nameError && (
                        <p className="text-sm text-red-600">{nameError}</p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          onClick={handleSaveFamilyName}
                          disabled={isSavingName || !familyName.trim()}
                          size="sm"
                          className="flex-1"
                        >
                          {isSavingName ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Save className="h-4 w-4 mr-2" />
                              {t('common:save')}
                            </>
                          )}
                        </Button>
                        <Button
                          onClick={() => {
                            setIsEditingName(false);
                            setFamilyName(familyData?.name || '');
                            setNameError(null);
                          }}
                          variant="outline"
                          size="sm"
                          disabled={isSavingName}
                        >
                          {t('common:cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="font-mono text-lg font-bold tracking-widest text-primary-600">
                          {familyData?.name || '—'}
                        </div>
                      </div>
                      {owner && (
                        <Button
                          onClick={() => setIsEditingName(true)}
                          variant="ghost"
                          size="sm"
                          className="text-gray-500 hover:text-gray-700 ml-2"
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          {t('familySettings.editFamilyName')}
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Invite Code Row - only visible for owners and parents */}
                {isParentOrOwner && (
                  <div className="py-3">
                    <label className="block text-sm font-medium text-gray-500 mb-2">
                      {t('familySettings.inviteCode')}
                    </label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                        <span className="font-mono text-lg font-bold tracking-widest text-primary-600">
                          {inviteCode || '—'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          onClick={handleCopyInviteCode}
                          disabled={copyingInviteCode || !inviteCode}
                          aria-label={t('familySettings.copyInviteAria')}
                          className="flex-1 sm:flex-none justify-center"
                        >
                          {copyingInviteCode ? (
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          ) : copyStatus === 'success' ? (
                            <CheckCircle className="h-4 w-4 mr-2 text-green-600" />
                          ) : copyStatus === 'error' ? (
                            <AlertTriangle className="h-4 w-4 mr-2 text-red-600" />
                          ) : (
                            <Copy className="h-4 w-4 mr-2" />
                          )}
                          {copyingInviteCode ? (
                            t('common:copying')
                          ) : copyStatus === 'success' ? (
                            t('familySettings.copied')
                          ) : copyStatus === 'error' ? (
                            t('familySettings.copyFailed')
                          ) : (
                            t('common:copy')
                          )}
                        </Button>
                        {owner && (
                          <Button
                            variant="outline"
                            onClick={handleRegenerateInviteCode}
                            aria-label={t('familySettings.regenerateInviteAria')}
                            className="flex-1 sm:flex-none justify-center"
                          >
                            {t('familySettings.regenerateInvite')}
                          </Button>
                        )}
                      </div>
                    </div>
                    {copyStatus === 'success' && (
                      <p className="text-sm text-green-600 mt-2">{t('familySettings.inviteCodeCopied')}</p>
                    )}
                    {copyStatus === 'error' && (
                      <p className="text-sm text-red-600 mt-2">{t('familySettings.inviteCodeCopyFailed')}</p>
                    )}
                  </div>
                )}

                {/* Member Count Row */}
                <div className="py-3">
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    {t('familySettings.memberCount')}
                  </label>
                  <div className="font-semibold text-gray-900">
                    {memberCount}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Section>
        </div>
      )}

      {/* Members Section */}
      {activeSection === 'members' && (
        <div className="space-y-6">
          <Section
            id="family-settings-members-section"
            icon={Users}
            title={t('familySettings.members')}
            description={t('familySettings.membersDesc')}
          >
            <div className="space-y-6">
              {/* Parents Section */}
              <section aria-labelledby="family-settings-parents-heading">
                <h3 id="family-settings-parents-heading" className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  {t('familySettings.parents')}
                </h3>
                <div className="space-y-3">
                  {familyMembers.filter(m => isParentRole(m.role)).map(member => (
                    <Card key={member.id}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Avatar src={member.avatarUrl} fallback={member.displayName[0]} />
                          <div>
                            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                              {member.displayName}
                              {getRoleLabel(member.role) && (
                                <span className="text-xs font-medium text-primary-600 bg-primary-50 px-2 py-1 rounded-full">
                                  {getRoleLabel(member.role)}
                                </span>
                              )}
                            </h4>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {owner && (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-500">
                        {t('familySettings.addParentInviteExplanation')}
                      </p>
                      <Button variant="outline" className="w-full" onClick={() => setShowAdultInvite(true)}>
                        {t('familySettings.addParentOrAdult')}
                      </Button>
                      {showAdultInvite && (
                        <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 space-y-3">
                          <p className="text-sm text-primary-900">
                            Share this family code. The adult signs up normally and requests to join this family.
                          </p>
                          <p className="font-mono text-xl font-bold tracking-widest text-primary-700">
                            {inviteCode || '—'}
                          </p>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyInviteCode}
                            disabled={!inviteCode || copyingInviteCode}
                          >
                            {t('common:copy')}
                          </Button>
                        </div>
                      )}
                      {copyStatus === 'success' && (
                        <p className="text-sm text-green-600" role="status">
                          {t('familySettings.inviteCodeCopied')}
                        </p>
                      )}
                      {copyStatus === 'error' && (
                        <p className="text-sm text-red-600" role="alert">
                          {t('familySettings.inviteCodeCopyFailed')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* Children Section */}
              <section aria-labelledby="family-settings-children-heading">
                <h3 id="family-settings-children-heading" className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                  {t('familySettings.children')}
                </h3>
                <div className="space-y-3">
                  {familyMembers.filter(m => isChildRole(m.role)).map(member => (
                    <Card key={member.id}>
                      <CardContent className="p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <Avatar src={member.avatarUrl} fallback={member.displayName[0]} />
                          <div>
                            <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                              {member.displayName}
                              {member.isManaged && (
                                <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                                  {t('familySettings.managed')}
                                </span>
                              )}
                            </h4>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-gray-500">
                            {t('familySettings.loginEnabled')}: {member.loginEnabled ? t('common:yes') : t('common:no')}
                          </span>
                          {isParentOrOwner && (
                            <Button variant="ghost" size="sm" className="text-gray-500 hover:text-gray-700" onClick={() => setEditingMember(member)}>
                              {t('common:edit')}
                            </Button>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                  {owner && pendingJoinRequests.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <h4 className="font-semibold text-amber-900 mb-2 flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        {t('familySettings.pendingApprovals')}
                      </h4>
                      <p className="text-sm text-amber-700">
                        {t('familySettings.pendingRequestCount', { count: pendingJoinRequests.length })}
                      </p>
                      <p className="text-sm text-amber-800 mt-1 mb-3">
                        {t('familySettings.pendingChildApprovalExplanation')}
                      </p>
                      <div className="space-y-2">
                        {pendingJoinRequests.map(request => (
                          <div key={request.id} className="bg-white rounded-lg p-3 flex items-center justify-between">
                            <div>
                              <p className="font-medium text-gray-900">{request.displayName}</p>
                              <p className="text-xs text-gray-500">
                                {t('familySettings.requestedOn', {
                                  date: request.createdAt?.toDate
                                    ? request.createdAt.toDate().toLocaleDateString(i18n.resolvedLanguage || i18n.language)
                                    : '—',
                                })}
                              </p>
                            </div>
                            <div className="flex gap-2">
                              <select
                                aria-label={`Approval role for ${request.displayName}`}
                                value={approvalRoles[request.id] ?? 'child'}
                                onChange={event => setApprovalRoles(previous => ({
                                  ...previous,
                                  [request.id]: event.target.value as 'child' | 'parent',
                                }))}
                                className="rounded-lg border border-gray-200 px-2 text-sm"
                              >
                                <option value="child">{t('familySettings.approveAsChild')}</option>
                                <option value="parent">{t('familySettings.approveAsParent')}</option>
                              </select>
                              <Button
                                size="sm"
                                className="bg-green-500 hover:bg-green-600"
                                onClick={() => handleApproveJoinRequest(request.id)}
                              >
                                {t(
                                  (approvalRoles[request.id] ?? 'child') === 'parent'
                                    ? 'familySettings.confirmParent'
                                    : 'familySettings.confirmChild',
                                )}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-600 hover:bg-red-50"
                                onClick={() => handleRejectJoinRequest(request.id, t('familySettings.rejectionReason'))}
                              >
                                {t('familySettings.reject')}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {owner && (
                    <Button variant="outline" className="w-full" onClick={() => setShowAddChildModal(true)}>
                      + {t('familySettings.addChild')}
                    </Button>
                  )}
                </div>
              </section>
            </div>
          </Section>
        </div>
      )}

      {/* Regional Section */}
      {activeSection === 'regional' && (
        <div className="space-y-6">
          <Section
            id="family-settings-regional-section"
            icon={Globe}
            title={t('familySettings.regional')}
            description={t('familySettings.regionalDesc')}
          >
            <Card>
              <CardContent className="p-6 divide-y divide-gray-100">
                {/* Currency */}
                <div className="py-3">
                  <label htmlFor="family-settings-currency" className="block text-sm font-medium text-gray-500 mb-2">
                    {t('familySettings.currency')}
                  </label>
                  {owner ? (
                    <select
                      id="family-settings-currency"
                      value={regionalSettings.currencyCode}
                      onChange={(e) => setRegionalSettings(prev => ({ ...prev, currencyCode: e.target.value as SupportedCurrencyCode }))}
                      disabled={isSavingRegional}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    >
                      {CURRENCY_OPTIONS.map(opt => (
                        <option key={opt.code} value={opt.code}>{t(opt.labelKey)}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="font-semibold text-gray-900">
                      {t(CURRENCY_OPTIONS.find(o => o.code === regionalSettings.currencyCode)?.labelKey || 'familySettings.currencies.gbp')}
                    </div>
                  )}
                </div>

                {/* Timezone */}
                <div className="py-3">
                  <label htmlFor="family-settings-timezone" className="block text-sm font-medium text-gray-500 mb-2">
                    {t('familySettings.timezone')}
                  </label>
                  {owner ? (
                    <select
                      id="family-settings-timezone"
                      value={regionalSettings.timezone}
                      onChange={(e) => setRegionalSettings(prev => ({ ...prev, timezone: e.target.value }))}
                      disabled={isSavingRegional}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                    >
                      {getTimezoneOptions(i18n.resolvedLanguage || i18n.language, regionalSettings.timezone).map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="font-semibold text-gray-900">
                      {regionalSettings.timezone}
                    </div>
                  )}
                </div>

                {/* Week Starts */}
                <fieldset className="py-3">
                  <legend className="block text-sm font-medium text-gray-500 mb-2">
                    {t('familySettings.weekStarts')}
                  </legend>
                  {owner ? (
                    <div className="flex gap-2">
                      {WEEK_START_OPTIONS.map(opt => (
                        <Button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={regionalSettings.weekStartsOn === opt.value}
                          variant={regionalSettings.weekStartsOn === opt.value ? 'primary' : 'outline'}
                          className={regionalSettings.weekStartsOn === opt.value ? 'bg-primary-500' : ''}
                          onClick={() => setRegionalSettings(prev => ({ ...prev, weekStartsOn: opt.value }))}
                          disabled={isSavingRegional}
                        >
                          {t(opt.labelKey)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="font-semibold text-gray-900">
                      {t(WEEK_START_OPTIONS.find(o => o.value === regionalSettings.weekStartsOn)?.labelKey || 'familySettings.weekDays.monday')}
                    </div>
                  )}
                </fieldset>

                {/* Save Regional Settings */}
                {owner && (
                  <div className="pt-4">
                    {regionalError && (
                      <p className="text-sm text-red-600 mb-3">{regionalError}</p>
                    )}
                    <Button
                      type="submit"
                      disabled={isSavingRegional}
                      className="w-full bg-primary-500"
                      onClick={handleSaveRegionalSettings}
                    >
                      {isSavingRegional ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          {t('common:saving')}
                        </>
                      ) : (
                        t('common:save')
                      )}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </Section>
        </div>
      )}

     {/* Gamification Section */}
     {activeSection === 'gamification' && (
       <div className="space-y-6">
         <Section
           id="family-settings-gamification-section"
           icon={Globe}
           title={t('familySettings.gamification')}
           description={t('familySettings.gamificationDesc')}
         >
           <Card>
             <CardContent className="p-6 divide-y divide-gray-100">
               {/* Daily Goal Percentage */}
               <div className="py-3">
                 <label htmlFor="family-settings-daily-goal" className="block text-sm font-medium text-gray-500 mb-2">
                   {t('familySettings.dailyGoalPercentage')}
                 </label>
                 {owner ? (
                   <select
                     id="family-settings-daily-goal"
                     value={dailyGoalPercentage}
                     onChange={(e) => setDailyGoalPercentage(parseInt(e.target.value, 10))}
                     disabled={isSavingGamification}
                     className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition-all"
                   >
                     {Array.from({ length: 51 }, (_, i) => 50 + i).map(pct => (
                       <option key={pct} value={pct}>{pct}%</option>
                     ))}
                   </select>
                 ) : (
                   <div className="font-semibold text-gray-900">
                     {dailyGoalPercentage}%
                   </div>
                 )}
               </div>

               <div className="py-3">
                 <label htmlFor="family-settings-pet-box" className="flex items-center justify-between gap-4">
                   <span>
                     <span className="block text-sm font-medium text-gray-900">{t('familySettings.enablePetBox')}</span>
                     <span className="block text-sm text-gray-500">{t('familySettings.enablePetBoxDesc')}</span>
                   </span>
                   <input
                     id="family-settings-pet-box"
                     type="checkbox"
                     checked={petBoxEnabled}
                     onChange={event => setPetBoxEnabled(event.target.checked)}
                     disabled={!owner || isSavingGamification}
                     className="h-5 w-5 rounded border-gray-300 text-primary-600"
                   />
                 </label>
               </div>

               {/* Save Gamification Settings */}
               {owner && (
                 <div className="pt-4">
                   {gamificationError && (
                     <p className="text-sm text-red-600 mb-3">{gamificationError}</p>
                   )}
                   <Button
                     type="submit"
                     disabled={isSavingGamification}
                     className="w-full bg-primary-500"
                     onClick={handleSaveGamificationSettings}
                   >
                     {isSavingGamification ? (
                       <>
                         <Loader2 className="h-4 w-4 animate-spin mr-2" />
                         {t('common:saving')}
                       </>
                     ) : (
                       t('common:save')
                     )}
                   </Button>
                 </div>
               )}
             </CardContent>
           </Card>
         </Section>
       </div>
     )}

     {/* Danger Zone Section */}
      {activeSection === 'danger' && (
        <div className="space-y-6">
          <Section
            id="family-settings-danger-zone-section"
            icon={AlertTriangle}
            title={t('familySettings.dangerZone')}
            description={t('familySettings.dangerZoneDesc')}
          >
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto" />
                  <div>
                    <h3 className="text-lg font-semibold text-amber-900 mb-2">
                      {t('familySettings.dangerZoneTitle')}
                    </h3>
                    <p className="text-sm text-amber-700 mb-4">
                      {t('familySettings.dangerZoneDescription')}
                    </p>
                  </div>
                  <div className="space-y-2 text-sm text-amber-600">
                    <p>{t('familySettings.deleteFamily')}</p>
                    <p>{t('familySettings.leaveFamily')}</p>
                  </div>
                  <Button variant="outline" disabled className="text-amber-700 border-amber-300">
                    {t('familySettings.comingSoon')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </Section>
        </div>
      )}

      {/* Toast / snackbar */}
      <Toast toast={toast} onDismiss={() => setToast(null)} />

      {/* Add Child Modal */}
      {showAddChildModal && familyData?.id && (
        <AddChildModal
          familyId={familyData.id}
          onClose={() => setShowAddChildModal(false)}
          onChildAdded={() => {
            // Refresh will happen automatically via Firestore listeners
            showToast(t('familySettings.childAdded'));
          }}
        />
      )}

      {/* Edit Member Modal */}
      {editingMember && (
        <EditMemberModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
        />
      )}

    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  description,
  children
}: {
  id: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
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
