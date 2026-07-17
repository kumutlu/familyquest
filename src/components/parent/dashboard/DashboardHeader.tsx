import { useStore } from '../../../store/useStore';

export function getGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardHeader() {
  const { currentUser, familyData } = useStore();

  const firstName = currentUser?.displayName?.split(' ')[0] || 'there';
  const familyName = familyData?.name;

  return (
    <header>
      <h1 className="text-2xl font-bold text-gray-900 tracking-tight sm:text-3xl">
        {getGreeting()}, {firstName}
      </h1>
      <p className="mt-1 text-gray-500">
        Here&rsquo;s what&rsquo;s happening with your family today.
      </p>
      {familyName && (
        <span className="mt-3 inline-flex items-center rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-700">
          {familyName} family
        </span>
      )}
    </header>
  );
}
