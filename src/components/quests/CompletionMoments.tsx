import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FullScreenMoment } from '../queki/FullScreenMoment';
import { QuekiMascot } from '../queki/QuekiMascot';
import { QUEKI_MOTION, useReducedMotion } from '../../design/motion';

/**
 * CompletionMoment — immediate feedback when a quest is SUBMITTED.
 *
 * Honesty contract: XP/points are NOT confirmed until a parent approves (the
 * server-side gamification processor awards them). This moment therefore says
 * "+N potential" and "waiting for <parent>" — never a confirmed award.
 *
 * Auto-dismisses after QUEKI_MOTION.duration.completionMoment; tap dismisses
 * early. Reduced motion: no overlay animation classes are added (the shell's
 * own keyframe collapses to 0ms via tokens).
 */
export function CompletionMoment({
  questTitle,
  points,
  reviewerName,
  autoApproved,
  onDone,
}: {
  questTitle: string;
  points: number;
  /** Resolved parent display name when family data allows ("Waiting for Dad"). */
  reviewerName?: string;
  /** True when the quest required no approval — reward IS immediate. */
  autoApproved?: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation('quests');
  const reducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDone, QUEKI_MOTION.duration.completionMoment);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDone]);

  return (
    <FullScreenMoment tone={autoApproved ? 'xp' : 'brand'} data-testid="completion-moment">
      <button
        type="button"
        aria-label={t('approvedMoment.dismiss')}
        className="flex flex-col items-center gap-6 focus:outline-none"
        onClick={onDone}
      >
        <QuekiMascot state="celebration" size={reducedMotion ? 96 : 128} />
        <h1 className="text-display">{t('moment.completeTitle')}</h1>
        <p className="text-title opacity-90">{questTitle}</p>
        {autoApproved ? (
          <p className="font-balance text-xp-200" data-testid="confirmed-points">
            {t('moment.autoApproved', { points })}
          </p>
        ) : (
          <>
            <p className="font-balance text-xp-200" data-testid="potential-points">
              {t('moment.potentialPoints', { points })}
            </p>
            <p className="text-body opacity-80" role="status">
              {reviewerName
                ? t('moment.waitingLine', { name: reviewerName })
                : t('moment.waitingGeneric')}
            </p>
          </>
        )}
      </button>
    </FullScreenMoment>
  );
}

/**
 * ApprovedRewardMoment — the CONFIRMED award moment, shown only once the
 * authoritative approval has landed. XP (gold) and points (warm gold) are always
 * displayed as separate identities; wallet money is never involved here.
 */
export function ApprovedRewardMoment({
  xp,
  points,
  onDone,
}: {
  xp: number;
  points: number;
  onDone: () => void;
}) {
  const { t } = useTranslation('quests');
  const reducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(onDone, QUEKI_MOTION.duration.completionMoment);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onDone]);

  return (
    <FullScreenMoment tone="xp" data-testid="approved-moment">
      <button
        type="button"
        aria-label={t('approvedMoment.dismiss')}
        className="flex flex-col items-center gap-5 focus:outline-none"
        onClick={onDone}
      >
        <QuekiMascot state="celebration" size={reducedMotion ? 88 : 120} />
        <h1 className="text-display">{t('approvedMoment.title')}</h1>
        <div className="flex items-center gap-6">
          <span
            className="rounded-2xl bg-white/15 px-5 py-3 font-balance text-xp-100"
            data-testid="approved-xp"
          >
            {t('approvedMoment.xpAward', { xp })}
          </span>
          <span
            className="rounded-2xl bg-white/15 px-5 py-3 font-balance text-amber-200"
            data-testid="approved-points"
          >
            {t('approvedMoment.pointsAward', { points })}
          </span>
        </div>
      </button>
    </FullScreenMoment>
  );
}
