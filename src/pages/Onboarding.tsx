import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { createFamilyAndParent, joinFamilyAsChild, signOut } from '../lib/api';
import { useStore } from '../store/useStore';

export function Onboarding() {
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [familyName, setFamilyName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const currentUser = useStore(state => state.currentUser);
  const navigate = useNavigate();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      await createFamilyAndParent(currentUser.uid, currentUser.displayName, familyName);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      await joinFamilyAsChild(currentUser.uid, currentUser.displayName, inviteCode);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center mb-8">
        <h2 className="text-3xl font-extrabold text-gray-900">Welcome to FamilyQuest</h2>
        <p className="mt-2 text-sm text-gray-600">Let's get your family setup.</p>
      </div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white p-8 rounded-xl shadow">
        {mode === 'select' && (
          <div className="space-y-4">
            <Button fullWidth size="lg" onClick={() => setMode('create')}>I'm a Parent (Create Family)</Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => setMode('join')}>I have an Invite Code</Button>
            <div className="pt-4 text-center">
              <button onClick={() => signOut()} className="text-sm text-gray-400 hover:text-gray-600">Sign Out</button>
            </div>
          </div>
        )}

        {mode === 'create' && (
          <form className="space-y-6" onSubmit={handleCreate}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Family Name</label>
              <input type="text" required placeholder="e.g., The Smiths" value={familyName} onChange={e => setFamilyName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>Back</Button>
              <Button type="submit" className="flex-1" disabled={loading}>Create Family</Button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form className="space-y-6" onSubmit={handleJoin}>
            <div>
              <label className="block text-sm font-medium text-gray-700">Invite Code</label>
              <input type="text" required placeholder="e.g., A1B2C3" value={inviteCode} onChange={e => setInviteCode(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md uppercase" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>Back</Button>
              <Button type="submit" className="flex-1" disabled={loading}>Join Family</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
