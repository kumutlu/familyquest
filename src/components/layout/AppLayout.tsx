import { Link, Outlet, useLocation, Navigate } from 'react-router-dom';
import { Home, Users, CheckSquare, Gift, Settings, Bell } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Avatar } from '../ui/Avatar';
import { useStore } from '../../store/useStore';
import { useState, useRef, useEffect } from 'react';

export function AppLayout() {
  const location = useLocation();
  const authUser = useStore(state => state.authUser);
  const currentUser = useStore(state => state.currentUser);
  const feed = useStore(state => state.feed);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // Close notifications on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const navItems = [
    { name: 'Home', path: '/', icon: Home },
    { name: 'Tasks', path: '/tasks', icon: CheckSquare },
    { name: 'Family', path: '/family', icon: Users },
    { name: 'Rewards', path: '/rewards', icon: Gift },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      {/* Top Navigation (Desktop & Mobile Header) */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Link to="/" className="flex items-center space-x-2 hover:opacity-80 transition-opacity">
              <div className="w-8 h-8 bg-primary-500 rounded-xl flex items-center justify-center text-white font-bold">
                F
              </div>
              <span className="text-xl font-extrabold tracking-tight text-gray-900">FamilyQuest</span>
            </Link>
            
            {/* Desktop Navigation */}
            <nav className="hidden md:flex ml-8 space-x-6">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link 
                    key={item.name} 
                    to={item.path} 
                    className={cn(
                      "flex items-center space-x-2 text-sm font-bold transition-colors", 
                      isActive ? "text-primary-600" : "text-gray-500 hover:text-gray-900"
                    )}
                  >
                    <Icon size={16} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="relative" ref={notifRef}>
              <button 
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)} 
                className="p-2 text-gray-400 hover:text-gray-600 transition-colors relative"
              >
                <Bell size={24} />
                {feed.length > 0 && <span className="absolute top-2 right-2 w-2 h-2 bg-primary-500 rounded-full border border-white"></span>}
              </button>
              
              {isNotificationsOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden z-50">
                  <div className="p-3 border-b border-gray-50 bg-gray-50 font-bold text-gray-900 text-sm">
                    Notifications
                  </div>
                  <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                    {feed.length === 0 ? (
                      <div className="p-4 text-center text-sm text-gray-500">No new notifications</div>
                    ) : (
                      feed.slice(0, 10).map((item: any) => (
                        <div key={item.id} className="p-3 bg-white hover:bg-gray-50 rounded-xl transition-colors text-sm text-gray-700">
                           {item.text}
                          <div className="text-[10px] text-gray-400 mt-1">
                            {item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : 'Just now'}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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
