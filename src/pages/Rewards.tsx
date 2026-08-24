import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpButton } from '../help/components/HelpButton';
import { Card, CardContent } from '../components/ui/Card';
import { PageLoader } from '../components/ui/PageLoader';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Plus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { redeemReward, createReward, updateReward } from '../lib/api';
import { mapTransactionError } from '../lib/transactionErrors';
import { RewardCelebrationOverlay } from '../components/rewards/RewardCelebrationOverlay';
import { RewardCard, RewardIcon } from '../components/rewards/RewardCard';
import { RewardDetailSheet } from '../components/rewards/RewardDetailSheet';
import { buildRewardShop, childVisibleShop, type ShopReward } from '../lib/rewards/shop';
import { cn } from '../lib/utils';
import { isParentRole } from '../lib/roles';
import { formatNumber, formatRelativeTime } from '../i18n/format';
import { Avatar } from '../components/ui/Avatar';
import { HistoryActionControl } from '../components/reversals/HistoryActionControl';
import { findReversal } from '../lib/reversalHistory';
import { QuekiMascot } from '../components/queki/QuekiMascot';
import { triggerHaptic } from '../lib/interaction/haptics';
import { playCue } from '../lib/interaction/sound';

/**
 * Rewards — Queki v2 Wave 3 REWARD SHOP.
 *
 * Browsable and tactile: a coral semantic grid of reward cards under a single
 * points hero. The domain engine stays authoritative — `redeemReward` deducts
 * points and completes the redemption inside one Firestore transaction; this
 * surface never mutates balances locally and only celebrates confirmed results.
 */
export function Rewards() {
  const { t } = useTranslation(['rewards', 'errors']);
  const { currentUser, rewards, redemptions, loading, familyMembers, reversals } = useStore();
  const [selectedReward, setSelectedReward] = useState<ShopReward | null>(null);
  const isParent = isParentRole(currentUser?.role);

  const formatRedemptionDateTime = (timestamp: any) => {
    const date = timestamp?.toDate ? timestamp.toDate() : timestamp instanceof Date ? timestamp : new Date(timestamp || 0);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today • ${timeStr}`;
    return `${formatRelativeTime(date)} • ${timeStr}`;
  };

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [formData, setFormData] = useState<any>({ title: '', cost: 50, icon: 'Gift', inventory: '' });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [celebration, setCelebration] = useState<{
    rewardTitle: string;
    rewardIcon: React.ReactNode;
    beforePoints: number;
    afterPoints: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Deterministic shop view-model (ordering + affordability + stock states),
  // derived purely from authoritative store data.
  const shop = useMemo(
    () => buildRewardShop(rewards, currentUser?.rewardPoints ?? 0),
    [rewards, currentUser?.rewardPoints],
  );
  const visibleShop = useMemo(() => childVisibleShop(shop), [shop]);

  if (loading || !currentUser) return <PageLoader label={t('rewards:loading')} />;

  const handleRedeem = async (reward: ShopReward) => {
    // Guard: a redemption must never be issued twice (no double deduction).
    if (isSubmitting) return;

    if ((currentUser.rewardPoints ?? 0) < reward.cost) {
      setError(t('rewards:details.notEnoughPoints'));
      return;
    }

    if (reward.availability !== 'available') {
      setError(t('rewards:details.outOfStock'));
      return;
    }

    setIsSubmitting(true);
    setError(null);

    // Balance as it stood before the request; the confirmed resulting balance
    // comes back from the redemption itself.
    const beforePoints = currentUser.rewardPoints || 0;

    try {
      // Inventory is decremented atomically inside redeemReward's Firestore
      // transaction; the client must never write reward stock itself.
      const result = await redeemReward(currentUser.familyId, currentUser.id, reward.id);

      triggerHaptic('rewardUnlock');
      playCue('rewardUnlock');

      // Only a confirmed, successful redemption opens the celebration.
      setSelectedReward(null);
      setCelebration({
        rewardTitle: result.rewardTitle || reward.title,
        rewardIcon: <RewardIcon icon={reward.icon} size={40} />,
        beforePoints,
        afterPoints: result.pointsAfter,
      });
    } catch (e: any) {
      // Never surface raw Firebase text to a child.
      setError(mapTransactionError(e, { operation: 'redeemReward' }) || t('errors:redeemFailed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateForm = () => {
    setFormData({ title: '', cost: 50, icon: 'Gift', inventory: '' });
    setIsFormOpen(true);
  };

  const openEditForm = (reward: ShopReward) => {
    const original = rewards.find(r => r.id === reward.id);
    setFormData({ ...original });
    setSelectedReward(null);
    setIsFormOpen(true);
  };

  const handleArchive = async (rewardId: string) => {
    if (confirm(t('errors:archiveRewardConfirm'))) {
      try {
        await updateReward(currentUser.familyId, rewardId, { isActive: false });
        setSelectedReward(null);
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const dataToSave = {
        title: formData.title,
        cost: Number(formData.cost),
        icon: formData.icon,
        isActive: true,
        inventory: formData.inventory === '' ? null : Number(formData.inventory)
      };

      if (formData.id) {
        await updateReward(currentUser.familyId, formData.id, dataToSave);
        setSuccessMsg(t('rewards:updateSuccess'));
      } else {
        await createReward(currentUser.familyId, dataToSave);
        setSuccessMsg(t('rewards:createSuccess'));
      }
      setIsFormOpen(false);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: any) {
      setError(e.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 pb-[calc(2.5rem+env(safe-area-inset-bottom))] animate-in fade-in duration-300">
      {/* ---- Points hero --------------------------------------------------- */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1">
            <h1 className="text-title qk-text-primary">{t('rewards:shop.title')}</h1>
            <HelpButton />
          </div>
          <p className="mt-1 text-meta qk-text-secondary">{t('rewards:shop.subtitle')}</p>
        </div>
        {isParent && (
          <Button onClick={openCreateForm} aria-label={t('rewards:addAria')} size="sm" className="bg-primary-500 hover:bg-primary-600 rounded-full h-10 w-10 p-0 shadow-lg flex items-center justify-center">
            <Plus size={20} />
          </Button>
        )}
      </header>

      <div
        className="flex items-center justify-center gap-2 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border py-4"
        data-testid="points-hero"
        role="status"
        aria-label={t('rewards:shop.pointsAria', { value: formatNumber(currentUser.rewardPoints) })}
      >
        <span aria-hidden="true" className="text-xl text-xp-500 dark:text-xp-400">★</span>
        <span className="text-title font-extrabold tabular-nums qk-text-primary" data-testid="points-hero-value">
          {formatNumber(currentUser.rewardPoints)}
        </span>
        <span className="text-meta font-semibold qk-text-secondary">
          {t('rewards:shop.pointsAria', { value: formatNumber(currentUser.rewardPoints) })}
        </span>
      </div>

      {successMsg && (
        <div className="rounded-xl bg-success-50 p-3 text-sm font-medium text-success-700 animate-in fade-in slide-in-from-top-2">
          {successMsg}
        </div>
      )}

      {/* ---- Shop grid ------------------------------------------------------ */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="reward-shop-grid">
        {visibleShop.length === 0 ? (
          <div
            className="col-span-2 flex flex-col items-center justify-center gap-3 rounded-card qk-bg-card qk-border-subtle qk-shadow-card border p-8 text-center sm:col-span-3"
            data-testid="reward-shop-empty"
          >
            <QuekiMascot state="happy" size={110} />
            <p className="text-body font-bold qk-text-primary">{t('rewards:shop.emptyTitle')}</p>
            <p className="text-meta qk-text-secondary">{t('rewards:shop.emptyHint')}</p>
            {isParent && (
              <Button onClick={openCreateForm} size="sm" className="bg-primary-500 hover:bg-primary-600 mt-1">
                <Plus size={16} className="mr-1" />
                {t('rewards:addAria')}
              </Button>
            )}
          </div>
        ) : (
          visibleShop.map(reward => (
            <RewardCard key={reward.id} reward={reward} onOpen={setSelectedReward} />
          ))
        )}
      </div>

      {/* ---- Parent redemption history (progressive disclosure) ------------- */}
      {isParent && redemptions.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-900 dark:text-gray-100">{t('rewards:redemptionHistory')}</h2>
          <div className="space-y-2">
            {redemptions.map(redemption => {
              const reward = rewards.find(item => item.id === redemption.rewardId);
              const child = familyMembers.find((m: any) => m.id === redemption.userId);
              const childName = child?.displayName || t('rewards:redemptionHistoryUnknownMember');
              const childAvatar = child?.avatarUrl;
              const dateTimeStr = formatRedemptionDateTime(redemption.redeemedAt || redemption.createdAt);
              const reversal = findReversal(reversals || [], 'reward_redemption', redemption.id);
              return (
                <Card key={redemption.id}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Avatar src={childAvatar} fallback={childName[0] || '?'} size="sm" />
                          <p className="font-semibold text-gray-900 dark:text-gray-100 text-sm truncate">{childName}</p>
                          {reversal && (
                            <Badge variant="danger" data-testid="reversal-status">
                              {t('rewards:reversed')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                          {t('rewards:redemptionHistoryRedeemed', { name: childName, reward: reward?.title || 'Reward' })}
                        </p>
                        <p className={cn('text-xs text-gray-500 mt-0.5', reversal && 'line-through decoration-gray-300')}>
                          {t('rewards:redeemedPoints', { value: formatNumber(redemption.costPaid) })}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">{dateTimeStr}</p>
                      </div>
                      <div className="shrink-0">
                        <HistoryActionControl sourceKind="reward_redemption" source={redemption} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Focused detail surface ----------------------------------------- */}
      <RewardDetailSheet
        reward={selectedReward}
        childPoints={currentUser.rewardPoints ?? 0}
        isParent={isParent}
        isRedeeming={isSubmitting}
        error={error}
        onClose={() => {
          setSelectedReward(null);
          setError(null);
        }}
        onRedeem={handleRedeem}
        onEdit={openEditForm}
        onArchive={handleArchive}
      />

      {/* ---- Create/Edit Form Modal ------------------------------------------ */}
      {isFormOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-gray-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-gray-900 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-10 duration-300">
            <div className="px-6 py-4 flex justify-between items-center border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{formData.id ? t('rewards:form.editTitle') : t('rewards:form.newTitle')}</h3>
              <button onClick={() => setIsFormOpen(false)} className="p-2 -mr-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded-full text-gray-500">✕</button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('rewards:form.rewardTitle')}</label>
                  <input type="text" required value={formData.title} onChange={e => setFormData({...formData, title: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('rewards:form.cost')}</label>
                  <input type="number" required min="1" value={formData.cost} onChange={e => setFormData({...formData, cost: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('rewards:form.icon')}</label>
                  <select value={formData.icon} onChange={e => setFormData({...formData, icon: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                    <option value="Gift">{t('rewards:form.iconGift')}</option>
                    <option value="Gamepad2">{t('rewards:form.iconGamepad')}</option>
                    <option value="Pizza">{t('rewards:form.iconPizza')}</option>
                    <option value="Ticket">{t('rewards:form.iconTicket')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{t('rewards:form.inventory')}</label>
                  <input type="number" placeholder={t('rewards:form.inventoryPlaceholder')} min="0" value={formData.inventory} onChange={e => setFormData({...formData, inventory: e.target.value})} className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100" />
                  <p className="text-xs text-gray-500 mt-1">{t('rewards:form.inventoryHelp')}</p>
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}
                <div className="pt-4">
                  <Button type="submit" fullWidth disabled={isSubmitting} className="bg-primary-500 hover:bg-primary-600">
                    {isSubmitting ? t('rewards:form.saving') : t('rewards:form.save')}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ---- Confirmed unlock moment (only after transaction resolves) ------- */}
      <RewardCelebrationOverlay
        open={celebration !== null}
        rewardTitle={celebration?.rewardTitle ?? ''}
        rewardIcon={celebration?.rewardIcon}
        beforePoints={celebration?.beforePoints ?? 0}
        afterPoints={celebration?.afterPoints ?? 0}
        parentNotificationSent
        onClose={() => setCelebration(null)}
      />
    </div>
  );
}
