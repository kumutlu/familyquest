import { useState } from 'react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Bell, User, Shield, LogOut, Copy, Share2, X, Users } from 'lucide-react';
import { signOut } from '../lib/api';
import { useStore } from '../store/useStore';

export function Settings() {
  const currentUser = useStore(state => state.currentUser);
  const familyData = useStore(state => state.familyData);
  const [toast, setToast] = useState<string | null>(null);

  const sections = [
    { title: 'Account', icon: User, items: ['Edit Profile', 'Change Avatar'] },
    { title: 'Preferences', icon: Bell, items: ['Notifications', 'Theme', 'Sound Effects'] },
  ];

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (e) {
      console.error(e);
    }
  };

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const shareText = `Join my FamilyQuest family!\n\nhttps://familyquest-beta-402cb.web.app\n\nInvite Code: ${familyData?.inviteCode}`;

  const handleCopy = async () => {
    if (!familyData?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(familyData.inviteCode);
      showToast('Invite code copied to clipboard!');
    } catch (err) {
      console.error('Failed to copy', err);
    }
  };

  const handleShare = async () => {
    if (!familyData?.inviteCode) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: 'FamilyQuest Invite',
          text: shareText,
        });
      } else {
        await navigator.clipboard.writeText(shareText);
        showToast('Invite text copied to clipboard!');
      }
    } catch (err) {
      console.error('Failed to share', err);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
      </header>
      
      {toast && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 text-sm font-medium rounded-xl flex items-center justify-between animate-in slide-in-from-top-2 border border-green-200">
          <span>{toast}</span>
          <button onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <div className="space-y-6">
        {currentUser?.role === 'parent' && (
          <div>
            <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Shield size={16} /> Family Settings
            </h3>
            <Card>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-100">
                  <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left">
                    <span className="font-medium text-gray-900 flex items-center gap-3"><Users size={18} className="text-gray-400"/> Manage Members</span>
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  <button className="w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors text-left">
                    <span className="font-medium text-gray-900 flex items-center gap-3"><Shield size={18} className="text-gray-400"/> Permissions</span>
                    <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                  </button>
                  
                  {/* Invite Code Block */}
                  <div className="p-4 bg-gray-50">
                    <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Family Invite Code</label>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center justify-between">
                        <span className="font-mono text-lg font-bold tracking-widest text-primary-600">
                          {familyData?.inviteCode || '...'}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="secondary" onClick={handleCopy} className="flex-1 sm:flex-none justify-center">
                          <Copy size={16} className="mr-2" /> Copy
                        </Button>
                        <Button onClick={handleShare} className="flex-1 sm:flex-none justify-center">
                          <Share2 size={16} className="mr-2" /> Share
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

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
