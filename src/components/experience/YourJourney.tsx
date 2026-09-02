/**
 * <YourJourney /> — the V2 long-term composition for the Child Home.
 *
 * Architectural rules
 * -------------------
 *   - ONE outer surface. Inside, TWO internal zones (Pet Box · Current Goal)
 *     sit side-by-side at ~390px and remain semantically independent.
 *   - NO shared progress track. NO destination star. NO sequential metaphor.
 *     The earlier v1 "Pet Box → Goal → Star" track was explicitly rejected
 *     and is NOT reproduced here.
 *   - Pet Box data is sourced from the canonical `funds[]` collection; we
 *     never invent a balance or progress bar (Pet Box does not progress
 *     INTO anything).
 *   - Goal data is sourced from the canonical `savingsGoals[]` collection.
 *     The goal's own progress visualization (filled with the brand gradient)
 *     is owned solely by the Goal zone.
 *   - Level / next-level information is NEVER repeated here — it already
 *     belongs in the Identity Hero. This section represents long-term
 *     progression, not XP.
 *   - A calm empty state is rendered when the child has no active goal,
 *     so we never fabricate a goal.
 *   - Tapping either zone navigates to the canonical route: /pet-box or
 *     /goals respectively. No second navigation path.
 *   - Tap on the outer surface as a whole opens the most-urgent surface
 *     (Goal when active, otherwise Pet Box). The zones are also individually
 *     tappable.
 *
 * Preview injection boundary
 * --------------------------
 * Production callers MUST omit `previewData` — the canonical Zustand store
 * is the only authority. DEV/TEST fixtures may pass a `previewData` object
 * that supplies deterministic Pet Box + Goal numbers for visual QA; the
 * fixture values are NEVER persisted and the production economic path
 * remains untouched.
 */

import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PawPrint, Target } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { isPetBoxEnabled } from '../../lib/familyFeatures';
import { formatMoney } from '../../lib/walletPresentation';
import { cn } from '../../lib/utils';

export interface YourJourneyPreviewData {
  /** Primary Pet Box display name. */
  readonly petBoxName?: string;
  /** Pet Box balance, in pence. */
  readonly petBoxBalancePence?: number;
  /** Optional feeding cadence label, e.g. "Feeding in 7 days". */
  readonly petBoxFeedingLabel?: string;
  /** Optional active goal id. */
  readonly primaryGoalId?: string;
  /** Optional active goal title. */
  readonly primaryGoalTitle?: string;
  /** Optional active goal current amount, in pence. */
  readonly primaryGoalCurrentPence?: number;
  /** Optional active goal target amount, in pence. */
  readonly primaryGoalTargetPence?: number;
  /** Pet Box enabled flag override (preview only). */
  readonly petBoxEnabled?: boolean;
}

export interface YourJourneyProps {
  /** Family data needed to decide whether Pet Box is enabled. */
  readonly familyData: unknown;
  /** Optional override test id prefix. */
  readonly testIdPrefix?: string;
  /**
   * DEV/TEST-only fixture bundle. When provided, the band renders from these
   * values instead of the Zustand store. Production callers MUST leave this
   * undefined.
   */
  readonly previewData?: YourJourneyPreviewData | null;
}

interface PetBoxSummary {
  readonly name: string | null;
  readonly balancePence: number;
  readonly feedingLabel: string | null;
}

interface GoalSummary {
  readonly id: string;
  readonly title: string;
  readonly currentPence: number;
  readonly targetPence: number;
}

function computePetBox(
  isPreview: boolean,
  previewData: YourJourneyPreviewData | null | undefined,
  petBoxEnabled: boolean,
  funds: Array<{ name?: string; balance?: number }> | undefined,
): PetBoxSummary | null {
  if (!petBoxEnabled) return null;
  if (isPreview) {
    const balancePence = Math.max(
      0,
      Math.floor(Number(previewData?.petBoxBalancePence ?? 0)),
    );
    const name = typeof previewData?.petBoxName === 'string' && previewData.petBoxName.length > 0
      ? previewData.petBoxName
      : null;
    if (balancePence <= 0 && name === null) return null;
    return {
      name,
      balancePence,
      feedingLabel: previewData?.petBoxFeedingLabel ?? null,
    };
  }
  const list = Array.isArray(funds) ? funds : [];
  if (list.length === 0) return null;
  const balance = list.reduce((sum, f) => sum + Math.max(0, Number(f?.balance ?? 0)), 0);
  const primary = list[0];
  return {
    name: typeof primary?.name === 'string' && primary.name.length > 0 ? primary.name : null,
    balancePence: balance,
    feedingLabel: null,
  };
}

function computeGoal(
  isPreview: boolean,
  previewData: YourJourneyPreviewData | null | undefined,
  savingsGoals: Array<{
    goalId?: string;
    title?: string;
    currentAmountPence?: number;
    targetAmountPence?: number;
    status?: string;
  }> | undefined,
): GoalSummary | null {
  if (isPreview) {
    const id = typeof previewData?.primaryGoalId === 'string' ? previewData.primaryGoalId : 'preview-goal';
    const title = typeof previewData?.primaryGoalTitle === 'string' && previewData.primaryGoalTitle.length > 0
      ? previewData.primaryGoalTitle
      : null;
    const currentPence = Math.max(0, Math.floor(Number(previewData?.primaryGoalCurrentPence ?? 0)));
    const targetPence = Math.max(0, Math.floor(Number(previewData?.primaryGoalTargetPence ?? 0)));
    if (title === null || targetPence <= 0) return null;
    return { id, title, currentPence, targetPence };
  }
  const list = Array.isArray(savingsGoals) ? savingsGoals : [];
  const active = list.filter(g => (g?.status ?? 'active') === 'active');
  if (active.length === 0) return null;
  // Most recently progressed first — pick the first active goal.
  const primary = active[0];
  const title = typeof primary?.title === 'string' ? primary.title : '';
  const currentPence = Math.max(0, Math.floor(Number(primary?.currentAmountPence ?? 0)));
  const targetPence = Math.max(0, Math.floor(Number(primary?.targetAmountPence ?? 0)));
  if (title.length === 0 || targetPence <= 0) return null;
  return {
    id: typeof primary?.goalId === 'string' ? primary.goalId : 'goal',
    title,
    currentPence,
    targetPence,
  };
}

function clampPercentage(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  const ratio = (current / target) * 100;
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(100, Math.max(0, ratio));
}

/**
 * V2 long-term composition. Side-by-side Pet Box + Current Goal inside ONE
 * outer surface. Semantically independent, visually related.
 */
export function YourJourney({
  familyData,
  testIdPrefix = 'your-journey',
  previewData = null,
}: YourJourneyProps) {
  const { t } = useTranslation('home');
  const navigate = useNavigate();
  const isPreview = previewData != null;

  const store = useStore() as {
    funds?: Array<{ name?: string; balance?: number }>;
    savingsGoals?: Array<{
      goalId?: string;
      title?: string;
      currentAmountPence?: number;
      targetAmountPence?: number;
      status?: string;
    }>;
  };

  const petBoxEnabled = isPreview
    ? previewData?.petBoxEnabled === true
    : isPetBoxEnabled(familyData as Parameters<typeof isPetBoxEnabled>[0]);

  const petBox = computePetBox(isPreview, previewData, petBoxEnabled, store.funds);
  const goal = computeGoal(isPreview, previewData, store.savingsGoals);

  if (!petBox && !goal) return null;

  const onPressOuter = () => {
    // Open the most-urgent surface: Goal when active, otherwise Pet Box.
    if (goal) navigate('/goals');
    else if (petBox) navigate('/pet-box');
  };

  const onPressPetBox = () => {
    if (petBox) navigate('/pet-box');
  };

  const onPressGoal = () => {
    if (goal) navigate(`/goals?goal=${encodeURIComponent(goal.id)}`);
  };

  return (
    <section
      aria-label={t('child.journey.heading', { defaultValue: 'Your journey' })}
      data-testid={`${testIdPrefix}`}
      className="qk-journey"
    >
      <header className="qk-journey__header">
        <h2 className="qk-section-eyebrow">
          {t('child.journey.heading', { defaultValue: 'YOUR JOURNEY' })}
        </h2>
        <button
          type="button"
          onClick={onPressOuter}
          data-testid={`${testIdPrefix}-open`}
          aria-label={t('child.journey.openAria', { defaultValue: 'Open your journey' })}
          className="text-meta font-bold uppercase tracking-wide qk-text-link hover:underline focus:outline-none focus-visible:underline"
        >
          {t('child.journey.open', { defaultValue: 'Open' })}
        </button>
      </header>

      <div
        className="qk-journey__zones"
        data-testid={`${testIdPrefix}-zones`}
        data-zones-count={petBox && goal ? 2 : 1}
      >
        {petBox ? (
          <button
            type="button"
            data-testid={`${testIdPrefix}-petbox`}
            data-petbox-name={petBox.name ?? ''}
            onClick={onPressPetBox}
            aria-label={
              petBox.name
                ? t('child.journey.petBoxAria', {
                    name: petBox.name,
                    balance: formatMoney(petBox.balancePence),
                    defaultValue: `Open Pet Box for ${petBox.name}, ${formatMoney(petBox.balancePence)} saved`,
                  })
                : t('child.journey.petBoxAriaEmpty', {
                    balance: formatMoney(petBox.balancePence),
                    defaultValue: `Open Pet Box, ${formatMoney(petBox.balancePence)} saved`,
                  })
            }
            className={cn(
              'qk-journey__zone text-left',
              'hover:qk-bg-interactive focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500',
            )}
          >
            <span className="qk-journey__zone-eyebrow flex items-center gap-1.5">
              <span aria-hidden="true" className="qk-journey__petbox-icon">
                <PawPrint size={12} />
              </span>
              {t('child.journey.petBox.eyebrow', { defaultValue: 'Pet Box' })}
            </span>
            <span className="qk-journey__zone-title">
              {petBox.name ?? t('child.journey.petBox.family', { defaultValue: 'Family pet fund' })}
            </span>
            <span className="qk-journey__zone-amount">
              {formatMoney(petBox.balancePence)}
            </span>
            {petBox.feedingLabel ? (
              <span className="qk-journey__petbox-foot" data-testid={`${testIdPrefix}-petbox-feed`}>
                {petBox.feedingLabel}
              </span>
            ) : null}
          </button>
        ) : null}

        {goal ? (
          <button
            type="button"
            data-testid={`${testIdPrefix}-goal`}
            data-goal-id={goal.id}
            onClick={onPressGoal}
            aria-label={t('child.journey.goalAria', {
              title: goal.title,
              current: formatMoney(goal.currentPence),
              target: formatMoney(goal.targetPence),
              percent: Math.round(clampPercentage(goal.currentPence, goal.targetPence)),
              defaultValue: `Open goal ${goal.title}, ${formatMoney(goal.currentPence)} of ${formatMoney(goal.targetPence)}`,
            })}
            className={cn(
              'qk-journey__zone text-left',
              'hover:qk-bg-interactive focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
            )}
          >
            <span className="qk-journey__zone-eyebrow flex items-center gap-1.5">
              <span aria-hidden="true" className="qk-journey__goal-icon">
                <Target size={12} />
              </span>
              {t('child.journey.goal.eyebrow', { defaultValue: 'Current Goal' })}
            </span>
            <span className="qk-journey__zone-title">{goal.title}</span>
            <span className="qk-journey__zone-amount">
              {formatMoney(goal.currentPence)}
              <span className="qk-journey__zone-foot">
                {' '}/ {formatMoney(goal.targetPence)}
              </span>
            </span>
            <span
              className="qk-journey__goal-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(clampPercentage(goal.currentPence, goal.targetPence))}
              aria-label={t('child.journey.goalProgressAria', { defaultValue: 'Goal progress' })}
              data-testid={`${testIdPrefix}-goal-track`}
            >
              <span
                className="qk-journey__goal-fill"
                style={{ width: `${clampPercentage(goal.currentPence, goal.targetPence)}%` }}
              />
            </span>
          </button>
        ) : (
          <div
            data-testid={`${testIdPrefix}-goal-empty`}
            className="qk-journey__zone"
            aria-label={t('child.journey.goalEmptyAria', { defaultValue: 'No active goal yet' })}
          >
            <span className="qk-journey__zone-eyebrow flex items-center gap-1.5">
              <span aria-hidden="true" className="qk-journey__goal-icon">
                <Target size={12} />
              </span>
              {t('child.journey.goal.eyebrow', { defaultValue: 'Current Goal' })}
            </span>
            <span className="qk-journey__zone-title">
              {t('child.journey.goalEmptyTitle', { defaultValue: 'No goal yet' })}
            </span>
            <p className="qk-journey__empty">
              {t('child.journey.goalEmptyBody', {
                defaultValue: 'Set a goal in Goals to start tracking it here.',
              })}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default YourJourney;
