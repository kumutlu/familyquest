
import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { Home, Users, CheckSquare, Gift, Wallet, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { useStore } from '../../store/useStore';

export function AppLayout() {
  const location = useLocation();
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);

  // Still loading auth state
  if (authUser === undefined) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Loading...</div>;
  }

  // Not logged in -> Login
  if (authUser === null) {
    return <Navigate to="/login" replace />;
  }

  // Logged in but no user doc yet (takes a moment to sync)
  if (authUser && currentUser === null) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center">Setting up...</div>;
  }

  // Logged in, user doc exists, but no familyId -> Onboarding (unless already there)
  if (currentUser && !currentUser.familyId && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Hide nav on onboarding
  

  const navItems = [
    { name: 'Home', path: '/', icon: Home },
    { name: 'Tasks', path: '/tasks', icon: CheckSquare },
    { name: 'Family', path: '/family', icon: Users },
    { name: 'Rewards', path: '/rewards', icon: Gift },
    { name: 'Wallet', path: '/wallet', icon: Wallet },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Top Navigation (Desktop & Mobile Header) */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-500 rounded-xl flex items-center justify-center text-white font-bold">
              F
            </div>
            <span className="text-xl font-extrabold tracking-tight text-gray-900">FamilyQuest</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <Link to="/settings" className="text-gray-400 hover:text-gray-600 transition-colors">
              <Settings size={24} />
            </Link>
            {currentUser && (
              <Avatar fallback={currentUser.displayName[0]} src={currentUser.avatarUrl} size="sm" className="ring-2 ring-primary-100" />
            )}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl mx-auto w-full p-4 pb-24 md:pb-8">
        <Outlet />
      </main>

      {/* Bottom Navigation (Mobile Only) */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 pb-safe z-40">
        <div className="flex justify-around items-center h-16">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            
            return (
              <Link
                key={item.name}
                to={item.path}
                className={cn(
                  "flex flex-col items-center justify-center w-full h-full space-y-1 transition-colors",
                  isActive ? "text-primary-600" : "text-gray-400 hover:text-gray-600"
                )}
              >
                <div className={cn(
                  "p-1 rounded-xl transition-all duration-200",
                  isActive ? "bg-primary-50 scale-110" : ""
                )}>
                  <Icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                </div>
                <span className="text-[10px] font-semibold">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
