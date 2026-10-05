import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronLeft, Lock, Palette, Sparkles, Star } from 'lucide-react';
import { useStore } from '../store/useStore';
import { updateChildTheme } from '../lib/api';
import { triggerHaptic } from '../lib/interaction/haptics';
import { TactileButton } from '../components/queki/TactileButton';
import { TactileCard } from '../components/queki/TactileCard';
import {
  useThemeShop,
  type ShopItem,
} from '../hooks/useThemeShop';
import { useExperienceTheme } from '../hooks/useExperienceTheme';
import { storeEquippedTheme } from '../hooks/useChildThemeRights';
import { ChildThemeSurface } from '../components/experience/ChildThemeSurface';
import { WorldPlate } from '../components/experience/WorldPlate';
import { getThemePlate, type ThemeDefinition } from '../domain/experience';

/**
 * Child-facing Theme Shop.
 *
 * UX contract (spec §21):
 *   Themes → see beautiful previews → tap one → preview → buy/apply →
 *   instant visual reward. No developer terminology, no nested settings,
 *   no ambiguous single-tap purchase: buying always passes through an
 *   explicit confirmation step, and a preview NEVER persists ownership.
 *
 * The page renders inside the ChildExperienceShell so the child's own
 * theme tokens keep shaping the shell while the shop is open. A preview
 * overrides the *card's* render (in-sheet) — it deliberately does not
 * re-skin the whole app session-wide until the child commits.
 */

/**
 * Which card the child opened.
 *
 * The shop item is stored as its ID and re-resolved from `items` on every
 * render, NOT as a snapshot. Ownership hydrates asynchronously (the purchase
 * projection is a background bootstrap listener), so a card opened a moment
 * before it landed used to keep rendering its stale state — the child saw
 * "Buy for 500 points" for a theme they already own, and the transaction then
 * refused with "You already own this theme".
 */
type Focus = { kind: 'classic' } | { kind: 'shop'; shopItemId: string } | null;

interface ThemePreviewProps {
  readonly theme: ThemeDefinition;
  readonly isDark: boolean;
  readonly badge?: string;
}

/**
 * The theme's real visual.
 *
 * Renders the RECOVERED painted Queki world for this theme (the artwork the
 * themes were authored with), cropped to the card. The previous implementation
 * drew abstract rectangles — a skeleton that looked nothing like the world a
 * child actually gets — which is why the live shop felt like a wireframe.
 *
 * A theme with no authored world falls back to its own token gradient; that is
 * a real (if quiet) themed surface, not a placeholder.
 */
function ThemePreview({ theme, isDark, badge }: ThemePreviewProps) {
  const tokens = theme.tokens;
  const plate = useMemo(() => getThemePlate(theme.id), [theme.id]);
  const style = useMemo(() => {
    if (!tokens) return undefined;
    return {
      '--qk-theme-accent': tokens.accent,
      '--qk-theme-accent-soft': tokens.accentSoft ?? tokens.accent,
      '--qk-theme-ambient-from': tokens.ambientFrom,
      '--qk-theme-ambient-to': tokens.ambientTo,
      '--qk-theme-pattern-density': String(tokens.patternDensity ?? 0),
    } as React.CSSProperties;
  }, [tokens]);
  return (
    <div
      data-testid={`theme-preview-${theme.id}`}
      data-preview-theme={theme.id}
      data-preview-kind={plate ? 'painted' : 'tokens'}
      className="relative h-32 w-full overflow-hidden rounded-xl"
      style={style}
    >
      {plate ? (
        <WorldPlate themeId={theme.id} plate={plate} variant="card" />
      ) : (
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(180deg, var(--qk-theme-ambient-from) 0%, var(--qk-theme-ambient-to) 100%)' }}
        />
      )}
      {badge ? (
        <span className="absolute right-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[11px] font-bold text-gray-900 shadow-sm backdrop-blur dark:bg-black/60 dark:text-white">
          {badge}
        </span>
      ) : null}
      <span className="sr-only">{isDark ? 'dark' : 'light'} preview</span>
    </div>
  );
}

function PromoCountdown({ endsAt, now }: { endsAt: number; now: number }) {
  const msLeft = Math.max(0, endsAt - now);
  const daysLeft = Math.ceil(msLeft / 86_400_000);
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-coral-600 dark:text-coral-300">
      <Sparkles size={12} aria-hidden="true" />
      {daysLeft > 0
        ? `Free this week · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
        : 'Free this week · last day'}
      <span className="sr-only"> (ends at {new Date(endsAt).toISOString()})</span>
    </span>
  );
}

export function ThemeShop() {
  const { t } = useTranslation('themes');
  const currentUser = useStore((s: any) => s.currentUser);
  const {
    items, classicTheme, themeOfTheWeek, isLoading, shoppingDisabled,
    points, purchasingItemId, purchaseError, purchase, clearError,
  } = useThemeShop();
  const { theme: activeTheme } = useExperienceTheme();
  const [focus, setFocus] = useState<Focus>(null);
  const [confirming, setConfirming] = useState(false);

  const classicActive = activeTheme.id === 'theme.standard';

  const applyTheme = async (themeId: string | null) => {
    if (!currentUser) return;
    try {
      await updateChildTheme(themeId);
      // Optimistic local mirror, scoped to this family + child; the profile
      // listener confirms from Firestore.
      const familyId: string = currentUser?.familyId ?? '';
      const childId: string = currentUser?.id ?? currentUser?.uid ?? '';
      storeEquippedTheme(themeId, familyId, childId);
      triggerHaptic('tap');
    } catch {
      // The rules deny unpurchased themes; the store snap-backs on next read.
    }
  };

  const buyAndApply = async (item: ShopItem) => {
    // Pre-flight: never fire a transaction the balance cannot satisfy. The
    // rules stay the authority; this only prevents a doomed round trip and
    // lets the sheet state the exact shortfall instead of a generic failure.
    if (!item.affordable) return;
    const ok = await purchase(item.shopItemId);
    if (ok) {
      setConfirming(false);
      await applyTheme(item.theme.id);
    }
  };

  // ---------------------------------------------------------------- focus ---
  if (focus) {
    // Always the LIVE item: ownership, promo windows and affordability can
    // all change while this panel is open.
    const focusItem =
      focus.kind === 'shop' ? items.find(item => item.shopItemId === focus.shopItemId) ?? null : null;
    const focusTheme = focus.kind === 'classic' ? classicTheme : focusItem?.theme ?? classicTheme;
    const isOwned = focus.kind === 'classic' || focusItem?.status === 'owned';
    const isPromo = focus.kind === 'shop' && focusItem?.status === 'promo';
    const isCurrent = focus.kind === 'classic' ? classicActive : activeTheme.id === focusTheme.id;
    return (
      <ChildThemeSurface
        resolvedTheme={{ theme: focusTheme, source: 'base', appliedEventName: null }}
        mascotPresentation={null}
        // Inside the persistent child boundary there is already a shell, so
        // this publishes the world being previewed rather than stacking a
        // second painted plate. Standalone (tests) it mounts its own shell.
        publishPreview
      >
        <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-4" data-testid="theme-shop-focus">
          <button
            type="button"
            onClick={() => { setFocus(null); setConfirming(false); clearError(); }}
            className="mb-4 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-black/5 dark:text-gray-200 dark:hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ChevronLeft size={16} aria-hidden="true" />
            {t('back', 'Back')}
          </button>

          <TactileCard className="p-4">
            <ThemePreview theme={focusTheme} isDark={false} />
            <h1 className="mt-3 text-title font-extrabold">{focusTheme.name}</h1>
            {isPromo && themeOfTheWeek ? (
              <p className="mt-1"><PromoCountdown endsAt={themeOfTheWeek.endsAt} now={Date.now()} /></p>
            ) : null}
            <p className="mt-2 text-body text-gray-600 dark:text-gray-300">
              {t('previewNote', 'This is how your quests could look.')}
            </p>

            {isCurrent ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-mint-50 px-3 py-2 text-sm font-bold text-mint-700 dark:bg-mint-900/30 dark:text-mint-200">
                <Check size={16} aria-hidden="true" /> {t('applied', 'Applied')}
              </div>
            ) : isOwned || isPromo ? (
              <TactileButton className="mt-4" fullWidth size="lg" onClick={() => applyTheme(focusTheme.id)}>
                {t('apply', 'Use this theme')}
              </TactileButton>
            ) : focus.kind === 'shop' && focusItem && !focusItem.shoppingDisabled ? (
              confirming ? (
                /* Purchase sheet. Deliberately a themed Queki surface rather
                   than a browser-style warning: the child sees the world they
                   are buying, what they have, and what is left afterwards. */
                <div
                  className="mt-4 rounded-2xl border border-black/10 bg-white/80 p-3 backdrop-blur dark:border-white/15 dark:bg-white/5"
                  data-testid="purchase-confirmation"
                  role="group"
                  aria-label={focusTheme.name}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-body font-extrabold">{focusTheme.name}</p>
                    <p className="text-body font-extrabold tabular-nums" style={{ color: 'var(--qk-theme-accent)' }}>
                      {t('sheetPrice', '{{price}} points', { price: focusItem.effectivePricePoints })}
                    </p>
                  </div>

                  {/* Themed preview — the same painted world the card shows. */}
                  <div className="mt-3">
                    <ThemePreview theme={focusTheme} isDark={false} />
                  </div>

                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex items-center justify-between">
                      <dt className="font-semibold text-gray-600 dark:text-gray-300">{t('sheetBalance', 'Your balance')}</dt>
                      <dd className="font-bold tabular-nums" data-testid="sheet-balance">
                        {t('sheetPoints', '{{value}} points', { value: points })}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="font-semibold text-gray-600 dark:text-gray-300">{t('sheetAfter', 'After purchase')}</dt>
                      <dd className="font-bold tabular-nums" data-testid="sheet-after">
                        {t('sheetPoints', '{{value}} points', { value: Math.max(0, points - focusItem.effectivePricePoints) })}
                      </dd>
                    </div>
                  </dl>

                  <TactileButton
                    className="mt-3"
                    variant="xp"
                    fullWidth
                    size="lg"
                    loading={purchasingItemId === focusItem.shopItemId}
                    disabled={purchasingItemId != null}
                    onClick={() => buyAndApply(focusItem)}
                  >
                    {t('unlock', 'Unlock for {{price}} points', { price: focusItem.effectivePricePoints })}
                  </TactileButton>
                  <TactileButton
                    className="mt-2"
                    variant="ghost"
                    fullWidth
                    size="sm"
                    onClick={() => { setConfirming(false); clearError(); }}
                  >
                    {t('confirmNo', 'Not now')}
                  </TactileButton>
                </div>
              ) : focusItem.affordable ? (
                <TactileButton className="mt-4" variant="xp" fullWidth size="lg" onClick={() => { clearError(); setConfirming(true); }}>
                  {t('buy', 'Buy for {{price}} points', { price: focusItem.effectivePricePoints })}
                </TactileButton>
              ) : (
                /* Short on points: preview stays fully available, but the buy
                   affordance is replaced — the child is told exactly how far
                   off they are instead of being led into a failed transaction. */
                <div
                  className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-900/25"
                  data-testid="theme-purchase-shortfall"
                >
                  <p className="text-body font-extrabold text-amber-900 dark:text-amber-100">
                    {t('needMore', 'Need {{value}} more points', { value: focusItem.shortfallPoints })}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-200">
                    {t('needMoreHint', 'Your balance: {{balance}} points · {{price}} points to unlock', {
                      balance: points,
                      price: focusItem.effectivePricePoints,
                    })}
                  </p>
                </div>
              )
            ) : (
              <p className="mt-4 rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 dark:bg-white/5 dark:text-gray-300">
                {t('shoppingDisabled', 'Theme shopping is turned off right now.')}
              </p>
            )}
            {purchaseError ? (
              <p role="alert" className="mt-2 text-sm font-semibold text-coral-600 dark:text-coral-300">{purchaseError}</p>
            ) : null}
          </TactileCard>
        </div>
      </ChildThemeSurface>
    );
  }

  // ----------------------------------------------------------------- list ---
  return (
    <ChildThemeSurface resolvedTheme={null} mascotPresentation={null}>
      <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-4" data-testid="theme-shop">
        <h1 className="flex items-center gap-2 text-title font-extrabold">
          <Palette size={22} aria-hidden="true" />
          {t('title', 'Themes')}
        </h1>
        <p className="mt-1 text-body text-gray-600 dark:text-gray-300">{t('subtitle', 'Make Queki feel like yours.')}</p>

        {themeOfTheWeek ? (
          <div className="mt-3 rounded-xl bg-coral-50 px-3 py-2 text-sm font-bold text-coral-700 dark:bg-coral-900/20 dark:text-coral-200" data-testid="theme-of-the-week-banner">
            <Star size={14} className="mr-1 inline" aria-hidden="true" />
            {t('totw', '{{name}} is free this week!', { name: themeOfTheWeek.theme.name })}
          </div>
        ) : null}

        {/* Parent control made visible: when shopping is disabled the child
            can still browse and preview, but nothing can be bought. */}
        {shoppingDisabled ? (
          <p
            className="mt-3 rounded-xl bg-gray-100 px-3 py-2 text-sm font-semibold text-gray-600 dark:bg-white/5 dark:text-gray-300"
            data-testid="theme-shopping-disabled-note"
          >
            {t('shoppingDisabled', 'Theme shopping is turned off right now.')}
          </p>
        ) : null}

        {/* Classic — always owned, always available. */}
        <button
          type="button"
          className="mt-4 block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl"
          onClick={() => { triggerHaptic('tap'); setFocus({ kind: 'classic' }); }}
          data-testid="theme-card-classic"
        >
          <TactileCard className="p-3">
            <ThemePreview theme={classicTheme} isDark={false} badge={classicActive ? t('current', 'Current') : undefined} />
            <div className="mt-2 flex items-center justify-between">
              <span className="font-bold">{classicTheme.name}</span>
              <span className="rounded-full bg-mint-100 px-2 py-0.5 text-xs font-bold text-mint-700 dark:bg-mint-900/40 dark:text-mint-200">
                {t('free', 'Free')}
              </span>
            </div>
          </TactileCard>
        </button>

        {/* Shop themes. */}
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => {
            const isCurrent = activeTheme.id === item.theme.id;
            const badge = isCurrent
              ? t('current', 'Current')
              : item.status === 'owned'
                ? t('owned', 'Owned')
                : item.status === 'promo'
                  ? t('freeThisWeek', 'Free this week')
                  : undefined;
            return (
              <button
                key={item.shopItemId}
                type="button"
                className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-2xl"
                onClick={() => { triggerHaptic('tap'); setFocus({ kind: 'shop', shopItemId: item.shopItemId }); }}
                data-testid={`theme-card-${item.shopItemId}`}
                aria-label={item.theme.name}
              >
                <TactileCard className="p-3">
                  <ThemePreview theme={item.theme} isDark={false} badge={badge} />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="truncate font-bold">{item.theme.name}</span>
                    {item.status === 'owned' || item.status === 'promo' ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-mint-600 dark:text-mint-300">
                        <Check size={12} aria-hidden="true" />
                        {item.status === 'owned' ? t('owned', 'Owned') : t('free', 'Free')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-gray-600 dark:text-gray-300">
                        <Lock size={12} aria-hidden="true" />
                        {t('price', '{{price}} pts', { price: item.effectivePricePoints })}
                      </span>
                    )}
                  </div>
                  {item.status === 'promo' && item.promo ? (
                    <p className="mt-1"><PromoCountdown endsAt={item.promo.endsAt} now={Date.now()} /></p>
                  ) : null}
                </TactileCard>
              </button>
            );
          })}
        </div>

        {isLoading ? (
          <p className="mt-4 text-center text-meta text-gray-500">{t('loading', 'Loading themes…')}</p>
        ) : null}
      </div>
    </ChildThemeSurface>
  );
}

export default ThemeShop;
