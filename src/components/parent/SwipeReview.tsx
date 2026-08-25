import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, History, HandCoins, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useStore } from '../../store/useStore';
import {
  approveTaskCompletion,
  approveTransferRequest,
  approveMoneyRequest,
  mapApprovalError,
  rejectTaskCompletion,
  rejectMoneyRequest,
  rejectTransferRequest,
} from '../../lib/api';
import {
  selectUnifiedReviewQueue,
  type ReviewItemKind,
  type UnifiedReviewItem,
} from '../../lib/quests/reviewQueue';
import { formatPence, resolveFamilyCurrencyCode } from '../../i18n/format';
import { QUEKI_MOTION, SWIPE_REVIEW, useReducedMotion } from '../../design/motion';
import { CharacterFrame } from '../queki/CharacterFrame';
import { QuekiMascot } from '../queki/QuekiMascot';
import { TactileButton } from '../queki/TactileButton';
import { BottomSheet } from '../queki/BottomSheet';
import { triggerHaptic } from '../../lib/interaction/haptics';
import { playCue } from '../../lib/interaction/sound';
import { MoneyValue } from '../privacy/MoneyValue';
import { WalletMoneyText } from '../privacy/WalletMoneyText';

/**
 * SwipeReview — Queki v2 parent fast-review flow (Waves 2 + 3).
 *
 * ONE typed review card at a time. Visible Reject / Approve buttons are
 * mandatory; left/right swipes are progressive enhancement with physical drag
 * feedback (translation + subtle rotation + resistance past the commit
 * threshold).
 *
 * Wave 3: the queue is TYPED — quest completions, family transfers and money
 * requests share the same gesture/mutation-safety shell while each kind keeps
 * its own domain mutation function and card body. Reward redemptions are not
 * reviewable (they complete instantly in `redeemReward`; parents reverse).
 *
 * Mutation safety:
 *  - per-item in-flight guard → a button press and a committed swipe can never
 *    both fire;
 *  - the exact reviewed item is tracked by its stable key;
 *  - cards are only discarded once the transaction resolves (or the item is
 *    authoritatively stale); failures restore the card with actionable copy;
 *  - authoritative reconciliation drops optimistically-handled keys when the
 *    listener confirms them, and resurrects nothing silently.
 */

type ExitDirection = 'approve' | 'reject';

interface DragState {
  dx: number;
  dragging: boolean;
}

const KIND_TEST_ID: Record<ReviewItemKind, string> = {
  quest: 'review-kind-quest',
  transfer: 'review-kind-transfer',
  money_request: 'review-kind-money-request',
};

export function SwipeReview() {
  const { t } = useTranslation('quests');
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const {
    currentUser,
    tasks,
    taskCompletions,
    transferRequests,
    moneyRequests,
    familyMembers,
    familyData,
    bootstrapStatus,
  } = useStore();

  const [handledKeys, setHandledKeys] = useState<Set<string>>(new Set());
  const [processingKey, setProcessingKey] = useState<string | null>(null);
  const [exit, setExit] = useState<{ key: string; direction: ExitDirection } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<UnifiedReviewItem | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [drag, setDrag] = useState<DragState>({ dx: 0, dragging: false });

  const inFlightRef = useRef(new Set<string>());
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<number | null>(null);

  const loading =
    !bootstrapStatus ||
    (['tasks', 'members'] as const).some(
      resource =>
        bootstrapStatus[resource] === 'loading' || bootstrapStatus[resource] === 'idle',
    );

  const queue = useMemo(
    () =>
      selectUnifiedReviewQueue({
        completions: taskCompletions,
        tasks,
        members: familyMembers,
        transferRequests,
        moneyRequests,
      }).filter(item => !handledKeys.has(item.key)),
    [taskCompletions, tasks, familyMembers, transferRequests, moneyRequests, handledKeys],
  );

  const current = queue[0];
  const next = queue[1];

  // Reconcile optimistic handling: any key no longer pending authoritatively
  // is dropped from `handledKeys` so the set cannot grow without bound.
  useEffect(() => {
    const pendingKeys = new Set(
      selectUnifiedReviewQueue({
        completions: taskCompletions,
        tasks,
        members: familyMembers,
        transferRequests,
        moneyRequests,
      }).map(item => item.key),
    );
    setHandledKeys(previous => {
      const reconciled = new Set([...previous].filter(key => pendingKeys.has(key)));
      return reconciled.size === previous.size ? previous : reconciled;
    });
  }, [taskCompletions, tasks, familyMembers, transferRequests, moneyRequests]);

  // ---------------------------------------------------------------------
  // Decision execution — exactly-once per item, kind-specific mutations.
  // ---------------------------------------------------------------------
  const executeDecision = useCallback(
    async (item: UnifiedReviewItem, direction: ExitDirection, comment?: string) => {
      if (!currentUser?.familyId) return;
      if (inFlightRef.current.has(item.key)) return; // button/swipe race guard
      inFlightRef.current.add(item.key);
      setProcessingKey(item.key);
      setError(null);
      setStaleNote(false);

      // Optimistic exit animation (the card comes back on failure).
      setExit({ key: item.key, direction });

      try {
        if (direction === 'approve') {
          if (item.kind === 'quest') {
            await approveTaskCompletion(currentUser.familyId, item.id);
          } else if (item.kind === 'transfer') {
            await approveTransferRequest(currentUser.familyId, item.id);
          } else {
            await approveMoneyRequest(currentUser.familyId, item.id);
          }
          triggerHaptic('approve');
          playCue('approve');
        } else {
          if (item.kind === 'quest') {
            await rejectTaskCompletion(currentUser.familyId, item.id, comment ?? '');
          } else if (item.kind === 'transfer') {
            await rejectTransferRequest(currentUser.familyId, item.id, comment ?? '');
          } else {
            await rejectMoneyRequest(currentUser.familyId, item.id, comment ?? '');
          }
          triggerHaptic('reject');
          playCue('reject');
        }
        setHandledKeys(previous => new Set(previous).add(item.key));
        // Move focus to the next card's Approve control (or caught-up panel)
        // once the exit animation completes.
        window.setTimeout(() => {
          const target = document.querySelector<HTMLElement>('[data-testid="review-approve"], [data-testid="swipe-review-caught-up"]');
          target?.focus?.();
        }, QUEKI_MOTION.duration.swipeExit);
      } catch (err) {
        const mapped = mapApprovalError(err, {
          requestPath: `families/${currentUser.familyId}/${item.kind}/${item.id}`,
          actorId: currentUser.id,
          actorRole: currentUser.role,
          actorFamilyId: currentUser.familyId,
          operation: direction,
        });
        if (mapped.stale) {
          // Already reviewed elsewhere — drop quietly with a neutral note.
          setHandledKeys(previous => new Set(previous).add(item.key));
          setStaleNote(true);
        } else {
          // Restore the card: never silently discard on real failures.
          setExit(null);
          setError(mapped.message || t('review.errorRetry'));
        }
      } finally {
        inFlightRef.current.delete(item.key);
        setProcessingKey(null);
        window.setTimeout(() => setExit(null), QUEKI_MOTION.duration.swipeExit);
      }
    },
    [currentUser, t],
  );

  const handleApprove = useCallback(
    (item: UnifiedReviewItem) => {
      void executeDecision(item, 'approve');
    },
    [executeDecision],
  );

  const handleCloseRejectSheet = useCallback(() => {
    setRejectTarget(null);
    setRejectComment('');
  }, []);

  const handleRejectConfirm = useCallback(() => {
    if (!rejectTarget) return;
    const comment = rejectComment.trim();
    const target = rejectTarget;
    setRejectTarget(null);
    setRejectComment('');
    void executeDecision(target, 'reject', comment);
  }, [executeDecision, rejectComment, rejectTarget]);

  // ---------------------------------------------------------------------
  // Drag physics
  // ---------------------------------------------------------------------
  const thresholdPx = () =>
    Math.max(48, (cardRef.current?.offsetWidth ?? 320) * SWIPE_REVIEW.commitThreshold);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!current || processingKey) return;
    dragStartRef.current = event.clientX;
    setDrag({ dx: 0, dragging: true });
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStartRef.current == null) return;
    let dx = event.clientX - dragStartRef.current;
    // Resistance past the commit threshold (rubber-banding).
    const limit = thresholdPx();
    if (Math.abs(dx) > limit) {
      const overshoot = Math.abs(dx) - limit;
      dx = Math.sign(dx) * (limit + overshoot * SWIPE_REVIEW.resistance);
    }
    setDrag({ dx, dragging: true });
  };

  const endDrag = (commit: boolean) => {
    const startX = dragStartRef.current;
    dragStartRef.current = null;
    if (startX == null) return;
    const dx = drag.dx;
    setDrag({ dx: 0, dragging: false });
    if (!commit || !current) return;
    const threshold = thresholdPx();
    if (dx >= threshold) {
      triggerHaptic('tap');
      void executeDecision(current, 'approve');
    } else if (dx <= -threshold) {
      triggerHaptic('tap');
      setRejectTarget(current); // rejection keeps its comment contract
    }
  };

  // ---------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4 pb-8" data-testid="swipe-review-loading" aria-busy="true">
        <div className="h-64 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
        <div className="h-14 animate-pulse rounded-card qk-bg-inset" aria-hidden="true" />
      </div>
    );
  }

  const caughtUp = !current;

  const rotationDeg = reducedMotion
    ? 0
    : Math.min(
        SWIPE_REVIEW.maxRotationDeg,
        (drag.dx / Math.max(1, cardRef.current?.offsetWidth ?? 320)) *
          SWIPE_REVIEW.maxRotationDeg *
          2,
      );
  const intent: ExitDirection | null =
    drag.dx > thresholdPx() ? 'approve' : drag.dx < -thresholdPx() ? 'reject' : null;

  const exitTransform =
    exit?.direction === 'approve'
      ? 'translateX(120%) rotate(10deg)'
      : 'translateX(-120%) rotate(-10deg)';

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col gap-4 pb-8" data-testid="swipe-review">
      {/* ---- Header -------------------------------------------------------- */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-title qk-text-primary">{t('review.title')}</h1>
          <p className="text-meta qk-text-secondary" role="status" data-testid="review-count">
            {t('review.queueCount', { count: queue.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1.5 text-meta font-bold text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <History size={14} aria-hidden="true" />
          {t('review.historyLink')}
        </button>
      </header>

      {staleNote && (
        <p role="status" className="rounded-xl bg-primary-50 p-3 text-body text-primary-700">
          {t('review.staleItem')}
        </p>
      )}

      {error && (
        <div role="alert" className="flex items-center gap-3 rounded-card bg-coral-50 p-4 text-coral-700">
          <p className="min-w-0 flex-1 text-body font-semibold">{error}</p>
          <TactileButton size="sm" variant="coral" onClick={() => setError(null)}>
            OK
          </TactileButton>
        </div>
      )}

      {caughtUp ? (
        <div
          className="flex flex-1 flex-col items-center justify-center gap-4 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-8 text-center"
          data-testid="swipe-review-caught-up"
          role="status"
        >
          <QuekiMascot state="happy" size={120} />
          <h2 className="text-title qk-text-primary">{t('review.allCaughtUpTitle')}</h2>
          <p className="text-body qk-text-secondary">{t('review.allCaughtUpDescription')}</p>
          <TactileButton onClick={() => navigate('/')}>{t('review.backHome')}</TactileButton>
        </div>
      ) : (
        <>
          {/* ---- Card stage ----------------------------------------------- */}
          <div className="relative flex-1" data-testid="swipe-stage">
            {/* Next card peeking underneath */}
            {next && (
              <div
                aria-hidden="true"
                className="absolute inset-x-3 top-3 h-full rounded-card qk-bg-inset border qk-border-subtle"
              />
            )}

            <div
              ref={cardRef}
              role="group"
              aria-label={t('review.title')}
              data-testid="review-card"
              data-intent={intent ?? undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              className={cn(
                'relative touch-pan-y select-none rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-6',
                !reducedMotion && !drag.dragging && 'transition-transform duration-[var(--animate-duration-swipe-exit)]',
                processingKey === current.key && 'opacity-70',
              )}
              style={{
                transform: exit?.key === current.key ? exitTransform : `translateX(${drag.dx}px) rotate(${rotationDeg}deg)`,
                transition: drag.dragging
                  ? undefined
                  : `transform var(--animate-duration-swipe-exit) var(--ease-swipe-exit)`,
              }}
            >
              {/* Kind badge — quest vs transfer vs money request are visually
                  distinct but part of the same Queki review system. */}
              <span
                data-testid={KIND_TEST_ID[current.kind]}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-meta font-bold',
                  current.kind === 'quest' && 'bg-gold-50 text-gold-600',
                  current.kind === 'transfer' && 'bg-mint-50 text-mint-700',
                  current.kind === 'money_request' && 'bg-blue-50 text-blue-600',
                )}
              >
                {current.kind === 'quest' && t('review.kindQuest')}
                {current.kind === 'transfer' && t('review.kindTransfer')}
                {current.kind === 'money_request' && t('review.kindMoneyRequest')}
              </span>

              {/* Child identity — always visually dominant. */}
              <div className="mt-4 flex items-center gap-4">
                <CharacterFrame
                  src={current.avatarUrl}
                  fallback={current.childName}
                  size={64}
                  ringColor={current.colour}
                  hero
                />
                <div className="min-w-0">
                  <p className="truncate text-title qk-text-primary">{current.childName}</p>
                  <p className="text-meta qk-text-secondary">
                    {t('review.completedWhen', {
                      time: new Date(current.createdAtMs).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                    })}
                  </p>
                </div>
              </div>

              {/* Kind-specific context */}
              <div className="mt-5 rounded-xl qk-bg-inset p-4">
                {current.kind === 'quest' && (
                  <>
                    <p className="text-card-title font-extrabold qk-text-primary">
                      {current.title}
                    </p>
                    <p className="mt-2 inline-flex rounded-full bg-xp-50 px-3 py-1 text-meta font-bold text-xp-700 dark:bg-xp-100 dark:text-xp-300">
                      {t('review.potentialReward', { points: current.pointsReward })}
                    </p>
                  </>
                )}
                {current.kind === 'transfer' && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-body font-bold qk-text-primary">{current.childName}</p>
                      <ArrowRight size={16} aria-hidden="true" className="shrink-0 qk-text-secondary" />
                      <p className="truncate text-body font-bold qk-text-primary">{current.counterpartyName}</p>
                    </div>
                    <p className="shrink-0 rounded-full bg-mint-50 px-3 py-1 text-meta font-bold text-mint-700">
                      <MoneyValue>{t('review.transferAmount', {
                          amount: formatPence(current.amountPence ?? 0, resolveFamilyCurrencyCode(familyData)),
                        })}</MoneyValue>
                    </p>
                  </div>
                )}
                {current.kind === 'money_request' && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-body font-bold qk-text-primary">
                        {t('review.moneyRequestFrom', { name: current.counterpartyName })}
                      </p>
                      <p className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-meta font-bold text-blue-600">
                        <MoneyValue>{t('review.transferAmount', {
                            amount: formatPence(current.amountPence ?? 0, resolveFamilyCurrencyCode(familyData)),
                          })}</MoneyValue>
                      </p>
                    </div>
                    {current.awaitingAcceptance && (
                      <p className="mt-2 inline-flex items-center gap-1.5 text-meta qk-text-secondary">
                        <HandCoins size={14} aria-hidden="true" />
                        {t('review.awaitingAcceptance', { name: current.counterpartyName })}
                      </p>
                    )}
                  </>
                )}
                {current.message && (
                  <p className="mt-2 truncate text-meta italic qk-text-secondary">
                    “<WalletMoneyText>{current.message}</WalletMoneyText>”
                  </p>
                )}
              </div>

              <p className="mt-4 text-center text-meta qk-text-secondary">{t('review.swipeHint')}</p>

              {/* Intent glows */}
              {intent && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-0 rounded-card border-4',
                    intent === 'approve' ? 'border-mint-400 bg-mint-50/30' : 'border-coral-400 bg-coral-50/30',
                  )}
                />
              )}
            </div>
          </div>

          {/* ---- Mandatory visible controls --------------------------------- */}
          <div className="grid grid-cols-2 gap-3">
            <TactileButton
              variant="coral"
              size="lg"
              disabled={processingKey === current.key || Boolean(exit)}
              onClick={() => setRejectTarget(current)}
              data-testid="review-reject"
            >
              <X size={18} aria-hidden="true" />
              {processingKey === current.key && exit?.direction === 'reject'
                ? t('review.rejecting')
                : t('review.reject')}
            </TactileButton>
            <TactileButton
              variant="mint"
              size="lg"
              disabled={processingKey === current.key || Boolean(exit)}
              onClick={() => handleApprove(current)}
              data-testid="review-approve"
            >
              <Check size={18} aria-hidden="true" />
              {processingKey === current.key && exit?.direction === 'approve'
                ? t('review.approving')
                : t('review.approve')}
            </TactileButton>
          </div>
        </>
      )}

      {/* ---- Rejection reason sheet (optional note) ------ */}
      <BottomSheet
        open={Boolean(rejectTarget)}
        onClose={handleCloseRejectSheet}
        aria-label={t('review.rejectReasonTitle')}
        title={t('review.rejectReasonTitle')}
      >
        <form
          className="space-y-4 pb-4"
          onSubmit={(event) => {
            event.preventDefault();
            handleRejectConfirm();
          }}
        >
          <textarea
            value={rejectComment}
            onChange={event => setRejectComment(event.target.value)}
            placeholder={t('review.rejectReasonPlaceholder', { name: rejectTarget?.childName ?? '', defaultValue: 'Add a note (optional)…' })}
            rows={3}
            autoFocus
            className="w-full rounded-xl border qk-border-subtle qk-bg-card p-3 text-body qk-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          />
          <div className="flex gap-3">
            <TactileButton
              variant="secondary"
              type="button"
              fullWidth
              onClick={handleCloseRejectSheet}
            >
              {t('review.cancel')}
            </TactileButton>
            <TactileButton
              variant="coral"
              type="submit"
              fullWidth
              disabled={Boolean(processingKey)}
              data-testid="reject-confirm-btn"
            >
              {t('review.rejectConfirm')}
            </TactileButton>
          </div>
        </form>
      </BottomSheet>
    </div>
  );
}
