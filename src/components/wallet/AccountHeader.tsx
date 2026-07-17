import { Avatar } from '../ui/Avatar';

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
  subtitle = 'My Wallet',
  accountStatus,
}: AccountHeaderProps) {
  const fallback = (name || '?').charAt(0).toUpperCase();
  return (
    <header className="flex items-center gap-3">
      <Avatar src={avatarUrl} fallback={fallback} size="lg" />
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-gray-900 truncate">{name}</h1>
        <p className="text-sm text-gray-500">{subtitle}</p>
        {accountStatus && (
          <span className="mt-1 inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
            {accountStatus}
          </span>
        )}
      </div>
    </header>
  );
}
