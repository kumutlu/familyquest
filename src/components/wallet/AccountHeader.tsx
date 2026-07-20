import { Avatar } from '../ui/Avatar';
import { useTranslation } from 'react-i18next';

interface AccountHeaderProps {
  name: string;
  avatarUrl?: string;
  subtitle?: string;
  accountStatus?: string;
}

// Child banking account header: avatar + display name + "My Wallet" label.
// No sensitive identifiers are shown.
export function AccountHeader({
  name,
  avatarUrl,
  subtitle,
  accountStatus,
}: AccountHeaderProps) {
  const { t } = useTranslation('wallet');
  const fallback = (name || '?').charAt(0).toUpperCase();
  const resolvedSubtitle = subtitle ?? t('accountHeader.subtitle');
  return (
    <header className="flex items-center gap-3">
      <Avatar src={avatarUrl} fallback={fallback} size="lg" />
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 truncate">{name}</h1>
        <p className="text-sm text-gray-500">{resolvedSubtitle}</p>
        {accountStatus && (
          <span className="mt-1 inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
            {accountStatus}
          </span>
        )}
      </div>
    </header>
  );
}
