import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Bell, User, Shield, LogOut } from 'lucide-react';
import { signOut } from '../lib/api';
import { useStore } from '../store/useStore';

export function Settings() {
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);

  const sections = [
    { title: 'Account', icon: User, items: ['Edit Profile', 'Change Avatar'] },
    { title: 'Preferences', icon: Bell, items: ['Notifications', 'Theme', 'Sound Effects'] },
  ];

  // Only show Family settings to parents
  if (currentUser?.role === 'parent') {
    sections.push({ title: 'Family', icon: Shield, items: ['Manage Members', 'Permissions', 'Invite Code: ' + (familyData?.inviteCode || 'Loading...')] });
  }

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </header>

      <div className="space-y-6">
        {sections.map(section => (
          <div key={section.title}>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <section.icon size={16} /> {section.title}
            </h3>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100">
                  {section.items.map(item => (
                    <button key={item} className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left">
                      <span className="font-medium text-gray-900">{item}</span>
                      <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}

        <Button variant="danger" fullWidth className="mt-8" onClick={handleSignOut}>
          <LogOut size={18} className="mr-2" /> Sign Out
        </Button>
      </div>
    </div>
  );
}
