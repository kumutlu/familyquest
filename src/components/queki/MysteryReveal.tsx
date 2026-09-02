import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Gift, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import type { MysteryDropReward } from '../../domain/mysteryDrop/types';

/**
 * <MysteryReveal /> — the reward feedback surface for a Mystery Drop.
 *
 * Architectural rules
 * -------------------
 *  - Presentational only. NEVER claims the drop itself; the authoritative
 *    award lives in the gamification processor (server-side). The reveal
 *    is opened by the parent only AFTER the authoritative claim has
 *    resolved.
 *  - The reward description is sourced from the resolved reward object —
 *    no arbitrary user text is rendered.
 *  - V1 disallowed rewards (cash, wallet money, paid loot boxes, point
 *    jackpots) are pinned by the resolver; this component does not need
 *    to defend against them, but we still assert `type` defensively.
 *  - REVEAL ACKNOWLEDGEMENT is UI state only. It MUST NOT be reward
 *    authority. The host passes `acknowledged` so the celebration beat
 *    does NOT replay on every Child Home remount. Once acknowledged, the
 *    reveal renders the "owned" beat in a calm, non-celebratory form.
 *
 * Lifecycle (Child Experience V1 productized staged reveal)
 * ---------------------------------------------------------
 *   1. Parent sets `open` to true with the resolved reward, AFTER the
 *      authoritative claim has landed (or with `acknowledged: true` when
 *      the user has already seen it once and we're rendering the owned
 *      state on subsequent mounts).
 *   2. When `acknowledged === false`, the reveal stages in three beats:
 *        - Anticipation (closed chest)        → ~360ms
 *        - Open (chest quick rotation + lift) → ~360ms
 *        - Reward (item emerges + rarity tag) → ~320ms
 *      Total target ~1.0–1.4s. Faster than the previous 1.4s flat beat;
 *      visually richer because it has three states.
 *   3. When `acknowledged === true`, the reveal renders the owned beat
 *      directly, with no chest preview and a single static affirmation.
 *   4. Reduced-motion users see the reward beat directly at t=0.
 */

export type MysteryRevealProps = {
  /** Visibility flag — host controls this after authoritative claim. */
  readonly open: boolean;
  /** The reward to reveal. */
  readonly reward: MysteryDropReward | null;
  /** Optional drop rarity, surfaced only for visual tone. */
  readonly rarity?: 'common' | 'rare' | 'epic';
  /** Required callback invoked when the user dismisses the surface. */
  readonly onClose: () => void;
  /** Optional aria label override. */
  readonly ariaLabel?: string;
  /**
   * When true, the celebration beat is suppressed and the surface shows
   * the owned beat directly. The host uses this to gate the reveal so
   * it does not replay on every Child Home remount. UI state only —
   * MUST NOT be reward authority.
   */
  readonly acknowledged?: boolean;
};

/**
 * Staged beat timings. Total ~1.04s in motion mode. Reduced-motion collapses
 * every beat to 0 via tokens (animation: ... 0ms).
 */
const STAGE_ANTICIPATION_MS = 360;
const STAGE_OPEN_MS = 360;
const STAGE_REWARD_MS = 320;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const RARITY_ACCENT: Record<NonNullable<MysteryRevealProps['rarity']>, string> = {
  common: 'from-xp-100 to-xp-200 text-xp-700',
  rare: 'from-family-100 to-family-200 text-family-700',
  epic: 'from-streak-100 to-streak-200 text-streak-700',
};

interface RewardCopy {
  readonly title: string;
  readonly description: string;
}

function rewardCopy(reward: MysteryDropReward | null, t: (key: string, params?: Record<string, unknown>) => string): RewardCopy {
  if (!reward) return { title: '', description: '' };
  if (reward.type === 'cosmetic_unlock') {
    return {
      title: t('child.adventure.mystery.rewardCosmeticTitle'),
      description: t('child.adventure.mystery.rewardCosmeticDescription', { itemId: reward.itemId }),
    };
  }
  if (reward.type === 'collection_item') {
    return {
      title: t('child.adventure.mystery.rewardCollectionTitle'),
      description: t('child.adventure.mystery.rewardCollectionDescription', { itemId: reward.itemId }),
    };
  }
  // xp_bonus — the resolver is the only producer; we never expose the
  // raw amount as money.
  return {
    title: `+${reward.amount.toLocaleString()} XP`,
    description: t('child.adventure.mystery.rewardXpDescription'),
  };
}

/**
 * Three-stage reveal state machine.
 *
 *   'anticipation' — closed chest
 *   'opening'      — chest opens
 *   'reward'       — item emerges
 */
type RevealBeat = 'anticipation' | 'opening' | 'reward';

export function MysteryReveal({
  open,
  reward,
  rarity,
  onClose,
  ariaLabel,
  acknowledged = false,
}: MysteryRevealProps) {
  const { t } = useTranslation('home');
  const [beat, setBeat] = useState<RevealBeat>(acknowledged ? 'reward' : 'anticipation');
  const timersRef = useRef<number[]>([]);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const clearTimers = () => {
    timersRef.current.forEach(id => window.clearTimeout(id));
    timersRef.current = [];
  };

  // ---- Lifecycle ---------------------------------------------------------
  useEffect(() => {
    if (!open) {
      clearTimers();
      setBeat(acknowledged ? 'reward' : 'anticipation');
      return;
    }

    previouslyFocusedRef.current =
      (document.activeElement as HTMLElement | null) ?? null;

    if (acknowledged || prefersReducedMotion()) {
      setBeat('reward');
      queueMicrotask(() => closeRef.current?.focus());
      return;
    }

    // Reset to anticipation beat, then advance through opening and reward.
    setBeat('anticipation');
    timersRef.current.push(
      window.setTimeout(() => setBeat('opening'), STAGE_ANTICIPATION_MS),
    );
    timersRef.current.push(
      window.setTimeout(
        () => setBeat('reward'),
        STAGE_ANTICIPATION_MS + STAGE_OPEN_MS,
      ),
    );
    timersRef.current.push(
      window.setTimeout(() => {
        closeRef.current?.focus();
      }, STAGE_ANTICIPATION_MS + STAGE_OPEN_MS + STAGE_REWARD_MS - 80),
    );

    return () => {
      clearTimers();
    };
  }, [open, acknowledged]);

  // ---- Escape / focus trap ----------------------------------------------
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Restore focus on close
  useEffect(() => {
    if (open) return;
    const restoreTo = previouslyFocusedRef.current;
    if (restoreTo && typeof restoreTo.focus === 'function') restoreTo.focus();
  }, [open]);

  if (!open || !reward) return null;
  if (typeof document === 'undefined') return null;

  const { title, description } = rewardCopy(reward, t);
  const accent = RARITY_ACCENT[rarity ?? 'common'];
  const showCelebration = !acknowledged;
  const showReward = !showCelebration || beat === 'reward';

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel ?? t('child.adventure.mystery.revealTitle', { title })}
      data-testid="mystery-reveal"
      data-reveal-state={acknowledged ? 'acknowledged' : 'celebration'}
      data-reveal-beat={beat}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
    >
      <div className="relative w-full max-w-sm">
        <div
          className={cn(
            'qk-bg-card rounded-hero p-6 qk-shadow-card',
            showCelebration && beat === 'anticipation' && 'animate-[mystery-reveal-enter_var(--animate-duration-celebration,700ms)_var(--ease-celebrate,cubic-bezier(0.34,1.56,0.64,1))]',
          )}
        >
          <button
            type="button"
            ref={closeRef}
            onClick={onClose}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/5 qk-text-secondary hover:bg-black/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-500"
            aria-label={t('child.adventure.mystery.closeAria')}
            data-testid="mystery-reveal-close"
          >
            <X size={18} aria-hidden="true" />
          </button>

          {/* Chest / anticipation beat — closed */}
          {showCelebration && beat === 'anticipation' && (
            <div className="flex flex-col items-center text-center">
              <div
                data-testid="mystery-reveal-chest-anticipation"
                className="qk-mystery-stage-chest relative mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-xp-200 to-xp-400 shadow-lg"
              >
                <Gift size={44} aria-hidden="true" className="text-white drop-shadow" />
              </div>
              <p className="text-card-title qk-text-primary">{t('child.adventure.mystery.readyTitle')}</p>
              <p className="mt-1 text-meta qk-text-secondary">
                {t('child.adventure.mystery.revealLoading')}
              </p>
            </div>
          )}

          {/* Opening beat — chest shaking/opening */}
          {showCelebration && beat === 'opening' && (
            <div className="flex flex-col items-center text-center">
              <div
                data-testid="mystery-reveal-chest-opening"
                className="qk-mystery-stage-chest relative mb-4 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-xp-300 to-xp-500 shadow-lg"
              >
                <Gift size={44} aria-hidden="true" className="text-white drop-shadow" />
                <Sparkles
                  size={18}
                  aria-hidden="true"
                  className="absolute -right-2 -top-2 text-xp-500"
                />
                <Sparkles
                  size={14}
                  aria-hidden="true"
                  className="absolute -bottom-1 -left-2 text-xp-500"
                />
              </div>
              <p className="text-card-title qk-text-primary">{t('child.adventure.mystery.readyTitle')}</p>
              <p className="mt-1 text-meta qk-text-secondary">
                {t('child.adventure.mystery.revealLoading')}
              </p>
            </div>
          )}

          {/* Reward beat — final reward card */}
          {showReward && (
            <div
              data-testid="mystery-reveal-reward-beat"
              className="qk-mystery-stage-reward flex flex-col items-center text-center"
            >
              <div
                className={cn(
                  'mb-4 inline-flex items-center gap-2 rounded-full bg-gradient-to-r px-4 py-1.5 text-meta font-bold uppercase tracking-wide shadow-sm',
                  accent,
                )}
              >
                <Sparkles size={14} aria-hidden="true" />
                {rarity ?? 'common'}
              </div>
              <p className="text-balance qk-text-primary" data-testid="mystery-reveal-title">
                {title}
              </p>
              <p className="mt-2 text-body qk-text-secondary">{description}</p>

              <button
                type="button"
                onClick={onClose}
                className="mt-5 inline-flex items-center justify-center rounded-full bg-family-500 px-5 py-2.5 text-button font-bold text-white shadow-md hover:bg-family-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-family-300"
                data-testid="mystery-reveal-action"
              >
                {t('child.adventure.mystery.acknowledgeAction')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default MysteryReveal;