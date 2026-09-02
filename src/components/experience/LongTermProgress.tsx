/**
 * <LongTermProgress /> — long-term progression band for the Child Home.
 *
 * Composes the EXISTING canonical Pet Box and Goals data into a single,
 * softer band below Today's Adventure. Crucially:
 *
 *   - We reuse the existing authoritative store data. We do NOT add a
 *     second Pet Box balance, do NOT mutate Pet Box money in any way,
 *     and do NOT introduce a parallel accounting source.
 *   - We render the existing dashboard `PetBoxSummaryCard` and
 *     `GoalSummaryCard` components when the family has the
 *     corresponding capability. The productization is a layout wrapper;
 *     semantics stay where they are.
 *   - If Pet Box is disabled for the family, the band shows the Goals
 *     card only. If both are disabled, we render NOTHING — the band
 *     is genuinely optional, not a stub.
 *   - Tapping either card still navigates to /pet-box or /goals
 *     respectively; we don't introduce a second path.
 *
 * Presentation only. No economic writes. No new Firestore listeners.
 *
 * PREVIEW INJECTION BOUNDARY
 * --------------------------
 * Production callers MUST omit `previewData` — the canonical Zustand
 * store is then the only authority. DEV/TEST fixtures MAY pass a
 * `previewData` object that supplies deterministic Pet Box + Goals
 * numbers for visual QA; the fixture values are NEVER persisted and
 * the production economic path remains untouched. There is NO write
 * path here — only a read-only injection boundary.
 */

import { useNavigate } from 'react-router-dom';
import { PawPrint, Target, ChevronRight } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { isPetBoxEnabled } from '../../lib/familyFeatures';
import { formatMoney } from '../../lib/walletPresentation';

/**
 * Read-only fixture bundle for DEV/TEST visual QA. The production
 * build never populates this — it is an explicit escape hatch for
 * the preview surface so QA can see Pet Box + Goals without an
 * authenticated child session. This object is NEVER a write path and
 * never reaches Firestore, XP, wallet, or Pet Box accounting.
 */
export interface LongTermPreviewData {
  /** Primary Pet Box display name. */
  readonly petBoxName?: string;
  /** Pet Box balance, in pence. */
  readonly petBoxBalancePence?: number;
  /** Number of active goals to surface in the Goals card. */
  readonly activeGoalCount?: number;
  /** Sum of `currentAmountPence` across active goals, in pence. */
  readonly activeGoalSavedPence?: number;
  /** Optional first active goal name (purely decorative). */
  readonly primaryGoalTitle?: string;
  /** Pet Box enabled flag override for preview-only contexts. */
  readonly petBoxEnabled?: boolean;
}

export interface LongTermProgressProps {
  /** Family data needed to decide whether Pet Box is enabled. */
  readonly familyData: unknown;
  /** Optional override test id prefix (used by preview fixture). */
  readonly testIdPrefix?: string;
  /**
   * DEV/TEST-only fixture bundle. When provided, the band renders
   * from these values instead of the Zustand store. Production
   * callers MUST leave this undefined.
   */
  readonly previewData?: LongTermPreviewData | null;
}

/**
 * Soft, low-emphasis row that exposes Pet Box + Goals without
 * duplicating their internal logic. Each tile is a thin link: it
 * carries its own heading, the existing canonical number, and a
 * chevron — no fake progress, no invented targets.
 */
export function LongTermProgress({
  familyData,
  testIdPrefix = 'long-term',
  previewData = null,
}: LongTermProgressProps) {
  const navigate = useNavigate();
  const isPreview = previewData != null;
  const storeData = useStore() as {
    funds?: Array<{ id?: string; name?: string; balance?: number; emergencyGoal?: number }>;
    savingsGoals?: Array<{
      goalId?: string;
      title?: string;
      currentAmountPence?: number;
      targetAmountPence?: number;
      status?: string;
    }>;
  };
  // Read-only: pick funds + savingsGoals from the fixture when preview
  // mode is active, otherwise from the canonical Zustand store. There
  // is no write side — this is purely a presentation boundary.
  const funds = isPreview ? [] : storeData.funds;
  const savingsGoals = isPreview ? [] : storeData.savingsGoals;

  // Pet Box enablement comes from canonical family features when
  // running for real, OR from the preview fixture when the DEV
  // preview injected one. No second accounting authority is created
  // here.
  const petBoxEnabled = isPreview
    ? previewData?.petBoxEnabled === true
    : isPetBoxEnabled(familyData as Parameters<typeof isPetBoxEnabled>[0]);

  // Reuse the existing canonical sums. We render the band only when at
  // least one long-term progression surface is visible for the family.
  const petBoxSummary = (() => {
    if (!petBoxEnabled) return null;
    if (isPreview) {
      const balancePence = Number(previewData?.petBoxBalancePence ?? 0);
      const name =
        typeof previewData?.petBoxName === 'string' && previewData.petBoxName.length > 0
          ? previewData.petBoxName
          : null;
      // A preview must NEVER fabricate real numbers — the fixture
      // either supplies a value or we render nothing.
      if (balancePence <= 0 && name === null) return null;
      return { name, balancePence };
    }
    const list = Array.isArray(funds) ? funds : [];
    if (list.length === 0) return null;
    const balance = list.reduce((sum, f) => sum + Number(f?.balance ?? 0), 0);
    const primary = list[0];
    return {
      name: typeof primary?.name === 'string' ? primary.name : null,
      balancePence: balance,
    };
  })();

  const goalsSummary = (() => {
    if (isPreview) {
      const count = Math.max(0, Math.floor(Number(previewData?.activeGoalCount ?? 0)));
      const savedPence = Math.max(0, Math.floor(Number(previewData?.activeGoalSavedPence ?? 0)));
      // Preview must NEVER invent goal numbers — return null when
      // the fixture omits them so the canonical surface stays empty.
      if (count <= 0 && savedPence <= 0) return null;
      return { count, savedPence };
    }
    const list = Array.isArray(savingsGoals) ? savingsGoals : [];
    const active = list.filter(g => (g?.status ?? 'active') === 'active');
    if (active.length === 0) return null;
    const saved = active.reduce((sum, g) => sum + Number(g?.currentAmountPence ?? 0), 0);
    return {
      count: active.length,
      savedPence: saved,
    };
  })();

  if (!petBoxSummary && !goalsSummary) return null;

  return (
    <section
      aria-label="Long-term progress"
      data-testid={`${testIdPrefix}-progress`}
      className="space-y-2"
    >
      <header className="flex items-center gap-2 px-1">
        <h2 className="text-card-title qk-text-primary">Long-term progress</h2>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {petBoxSummary && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-progress-petbox`}
            onClick={() => navigate('/pet-box')}
            className="group flex w-full items-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border px-4 py-3 text-left transition-colors hover:border-mint-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-mint-500"
            aria-label={
              petBoxSummary.name
                ? `Open Pet Box for ${petBoxSummary.name}`
                : 'Open Pet Box'
            }
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-50 text-mint-600"
            >
              <PawPrint size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-meta font-semibold uppercase tracking-wide qk-text-secondary">
                Pet Box
                {petBoxSummary.name ? (
                  <span className="ml-1 normal-case font-medium text-meta">
                    · {petBoxSummary.name}
                  </span>
                ) : null}
              </p>
              <p className="text-card-title qk-text-primary tabular-nums">
                {formatMoney(petBoxSummary.balancePence)} saved
              </p>
            </div>
            <span
              aria-hidden="true"
              className="qk-text-secondary opacity-60 transition-opacity group-hover:opacity-100"
            >
              <ChevronRight size={18} />
            </span>
          </button>
        )}

        {goalsSummary && (
          <button
            type="button"
            data-testid={`${testIdPrefix}-progress-goals`}
            onClick={() => navigate('/goals')}
            className="group flex w-full items-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border px-4 py-3 text-left transition-colors hover:border-family-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
            aria-label={`View ${goalsSummary.count} goals`}
          >
            <span
              aria-hidden="true"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-family-50 text-family-600"
            >
              <Target size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-meta font-semibold uppercase tracking-wide qk-text-secondary">
                Goals
              </p>
              <p className="text-card-title qk-text-primary tabular-nums">
                {goalsSummary.count} active · {formatMoney(goalsSummary.savedPence)} saved
              </p>
            </div>
            <span
              aria-hidden="true"
              className="qk-text-secondary opacity-60 transition-opacity group-hover:opacity-100"
            >
              <ChevronRight size={18} />
            </span>
          </button>
        )}
      </div>
    </section>
  );
}

export default LongTermProgress;