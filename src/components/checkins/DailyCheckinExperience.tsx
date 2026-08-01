import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DAILY_CHECKIN_CATALOG,
  resolveDailyCheckinEligibility,
  resolvedDailyCheckinSettings,
  resolvedParentParticipation,
  type DailyCheckinAnimal,
} from '../../lib/dailyCheckins';
import { skipDailyCheckin, submitDailyCheckin } from '../../lib/dailyCheckinsApi';
import { isChildRole, isParentRole } from '../../lib/roles';
import { useStore } from '../../store/useStore';
import { Toast, type ToastData } from '../ui/Toast';
import { DailyCheckinBadge } from './DailyCheckinBadge';
import { DailyCheckinModal } from './DailyCheckinModal';

interface DailyCheckinExperienceProps {
  children: ReactNode;
}

const DAY_REFRESH_INTERVAL_MS = 60_000;

type PendingOperation = {
  kind: 'checkin' | 'skip';
  contextKey: string;
  familyId: string;
  userId: string;
  localDate: string;
  animal?: DailyCheckinAnimal;
};

export function DailyCheckinExperience({ children }: DailyCheckinExperienceProps) {
  const { t } = useTranslation('checkins');
  const {
    currentUser,
    familyData,
    dailyCheckinDay,
    dailyCheckinStateResolved,
    todayDailyCheckin,
    todayDailyCheckinSkip,
    refreshDailyCheckinDay,
  } = useStore();
  const operationRef = useRef<PendingOperation | null>(null);
  const lockedRef = useRef(false);
  const toastIdRef = useRef(0);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const validRecord = todayDailyCheckin
    && todayDailyCheckin.localDate === dailyCheckinDay
    && todayDailyCheckin.userId === currentUser?.id
    && todayDailyCheckin.familyId === currentUser?.familyId
      ? todayDailyCheckin
      : null;
  const validSkip = todayDailyCheckinSkip
    && todayDailyCheckinSkip.localDate === dailyCheckinDay
    && todayDailyCheckinSkip.userId === currentUser?.id
    && todayDailyCheckinSkip.familyId === currentUser?.familyId
      ? todayDailyCheckinSkip
      : null;
  const role = isChildRole(currentUser?.role)
    ? 'child'
    : isParentRole(currentUser?.role) ? 'parent' : undefined;
  const childrenEnabled = resolvedDailyCheckinSettings(familyData?.dailyCheckins).childrenEnabled;
  const parentParticipationEnabled = resolvedParentParticipation(currentUser?.dailyCheckins);
  const requiredInputsResolved = Boolean(
    currentUser && familyData && dailyCheckinDay && role && dailyCheckinStateResolved,
  );
  const activeContextKey = JSON.stringify([
    currentUser?.id ?? null,
    currentUser?.familyId ?? null,
    familyData?.id ?? null,
    currentUser?.role ?? null,
    role ?? null,
    dailyCheckinDay,
    dailyCheckinStateResolved,
    childrenEnabled,
    parentParticipationEnabled,
  ]);
  const previousContextKeyRef = useRef(activeContextKey);
  const eligibility = resolveDailyCheckinEligibility({
    resolved: requiredInputsResolved,
    role,
    childrenEnabled,
    parentParticipationEnabled,
    checkinExists: Boolean(validRecord),
    skipExists: Boolean(validSkip),
  });

  useEffect(() => {
    const timer = window.setInterval(() => refreshDailyCheckinDay(), DAY_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refreshDailyCheckinDay]);

  useEffect(() => {
    const operation = operationRef.current;
    const contextChanged = previousContextKeyRef.current !== activeContextKey;
    previousContextKeyRef.current = activeContextKey;
    if (contextChanged || (operation && operation.contextKey !== activeContextKey)) {
      operationRef.current = null;
      lockedRef.current = false;
      setLocked(false);
      setError(null);
      return;
    }
    if (!operation) return;

    const recordPersisted = operation.kind === 'checkin' && Boolean(validRecord);
    const skipPersisted = operation.kind === 'skip' && Boolean(validSkip || validRecord);
    if (!recordPersisted && !skipPersisted) return;

    operationRef.current = null;
    lockedRef.current = false;
    setLocked(false);
    setError(null);

    if (operation.kind === 'checkin' && validRecord?.animal === operation.animal) {
      const option = DAILY_CHECKIN_CATALOG.find(item => item.id === validRecord.animal);
      if (option) {
        setToast({
          id: ++toastIdRef.current,
          message: t('badge.confirmation', { animal: t(option.nameKey) }),
          type: 'success',
        });
      }
    }
  }, [activeContextKey, t, validRecord, validSkip]);

  const beginOperation = (operation: PendingOperation) => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    operationRef.current = operation;
    setLocked(true);
    setError(null);

    const identity = {
      familyId: operation.familyId,
      userId: operation.userId,
      localDate: operation.localDate,
    };
    const request = operation.kind === 'checkin'
      ? submitDailyCheckin({ ...identity, animal: operation.animal! })
      : skipDailyCheckin(identity);

    void request.catch(() => {
      if (operationRef.current !== operation) return;
      operationRef.current = null;
      lockedRef.current = false;
      setLocked(false);
      setError(t('modal.error'));
    });
  };

  const operationIdentity = currentUser && dailyCheckinDay
    ? {
        contextKey: activeContextKey,
        familyId: currentUser.familyId,
        userId: currentUser.id,
        localDate: dailyCheckinDay,
      }
    : null;

  return (
    <>
      {validRecord && <DailyCheckinBadge animal={validRecord.animal} />}
      {children}
      <DailyCheckinModal
        open={eligibility === 'eligible'}
        locked={locked}
        error={error}
        onSelect={animal => {
          if (operationIdentity) beginOperation({ ...operationIdentity, kind: 'checkin', animal });
        }}
        onDismiss={() => {
          if (operationIdentity) beginOperation({ ...operationIdentity, kind: 'skip' });
        }}
      />
      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </>
  );
}
