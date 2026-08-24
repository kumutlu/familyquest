import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Target,
  Wallet,
  WalletCards,
  Cat,
  History,
  Bell,
  Settings,
  CircleHelp,
  MessageSquarePlus,
} from 'lucide-react';
import { BottomSheet } from '../queki/BottomSheet';
import { TactileButton } from '../queki/TactileButton';
import { isParentRole } from '../../lib/roles';

export interface MoreMenuProps {
  open: boolean;
  onClose: () => void;
  role: string | undefined | null;
  onReportProblem: () => void;
}

type MoreLabelKey =
  | 'more.goals'
  | 'more.wallets'
  | 'more.wallet'
  | 'more.catBox'
  | 'more.history'
  | 'more.notifications'
  | 'more.settings'
  | 'more.help';

interface MoreDestination {
  testId: string;
  path: string;
  labelKey: MoreLabelKey;
  icon: React.ReactNode;
  /** Which roles see this destination. */
  roles: 'all' | 'parent' | 'child';
}

/**
 * Single source of truth for the Queki v2 secondary (feature-parity) surface.
 *
 * The v2 bottom navigation intentionally carries only the four daily tabs
 * (Home, Quests, Rewards, Family) plus the Action composer. Every other
 * legitimate product area keeps its existing route and is reached from here —
 * restoring parity with the pre-v2 navigation without adding bottom-nav tabs.
 *
 * Adding a product area? Add it here AND to the feature-parity regression test
 * (tests/components/featureParity.test.tsx) so a future redesign cannot drop
 * it from user access again.
 */
export const MORE_DESTINATIONS: MoreDestination[] = [
  { testId: 'more-goals', path: '/goals', labelKey: 'more.goals', icon: <Target size={20} aria-hidden="true" />, roles: 'all' },
  { testId: 'more-wallets', path: '/wallets', labelKey: 'more.wallets', icon: <WalletCards size={20} aria-hidden="true" />, roles: 'parent' },
  { testId: 'more-wallet', path: '/wallet', labelKey: 'more.wallet', icon: <Wallet size={20} aria-hidden="true" />, roles: 'child' },
  { testId: 'more-cat-box', path: '/pet-box', labelKey: 'more.catBox', icon: <Cat size={20} aria-hidden="true" />, roles: 'parent' },
  { testId: 'more-history', path: '/history', labelKey: 'more.history', icon: <History size={20} aria-hidden="true" />, roles: 'all' },
  { testId: 'more-notifications', path: '/notifications', labelKey: 'more.notifications', icon: <Bell size={20} aria-hidden="true" />, roles: 'all' },
  { testId: 'more-settings', path: '/settings', labelKey: 'more.settings', icon: <Settings size={20} aria-hidden="true" />, roles: 'all' },
  { testId: 'more-help', path: '/help', labelKey: 'more.help', icon: <CircleHelp size={20} aria-hidden="true" />, roles: 'all' },
];

/** Destinations visible for the given role. */
export function getMoreDestinations(role: string | undefined | null): MoreDestination[] {
  const parent = isParentRole(role ?? '');
  return MORE_DESTINATIONS.filter(d =>
    d.roles === 'all' || (d.roles === 'parent' && parent) || (d.roles === 'child' && !parent),
  );
}

/**
 * Queki v2 secondary navigation hub ("More"). Role-aware sheet listing every
 * non-tab product area so no feature is ever more than one tap from any screen.
 */
export function MoreMenu({ open, onClose, role, onReportProblem }: MoreMenuProps) {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const destinations = getMoreDestinations(role);

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      aria-label={t('more.title', { defaultValue: 'More' })}
      title={t('more.title', { defaultValue: 'More' })}
    >
      <div className="grid gap-3 pb-2" data-testid="more-menu">
        {destinations.map(destination => (
          <TactileButton
            key={destination.path}
            variant="secondary"
            size="lg"
            fullWidth
            data-testid={destination.testId}
            onClick={() => {
              onClose();
              navigate(destination.path);
            }}
            className="justify-start gap-3 px-4"
          >
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-100"
            >
              {destination.icon}
            </span>
            <span className="font-button">{t(destination.labelKey)}</span>
          </TactileButton>
        ))}
        <TactileButton
          variant="secondary"
          size="lg"
          fullWidth
          data-testid="more-report-problem"
          onClick={() => {
            onClose();
            onReportProblem();
          }}
          className="justify-start gap-3 px-4"
        >
          <span
            aria-hidden="true"
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-100"
          >
            <MessageSquarePlus size={20} />
          </span>
          <span className="font-button">
            {t('bugReport.action', { defaultValue: 'Report a problem' })}
          </span>
        </TactileButton>
      </div>
    </BottomSheet>
  );
}
