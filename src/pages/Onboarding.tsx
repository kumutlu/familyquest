import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { createFamilyAndParent, requestToJoinFamily, createManagedMember, signOut } from '../lib/api';
import { useStore } from '../store/useStore';
import { Plus, Shield } from 'lucide-react';

export function Onboarding() {
  const [mode, setMode] = useState<'select' | 'create' | 'join'>('select');
  const [step, setStep] = useState(1);

  // Create state
  const [familyName, setFamilyName] = useState('');
  const [members, setMembers] = useState<{name: string, role: 'parent'|'child'}[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'parent'|'child'>('child');
  const [generatedFamilyId, setGeneratedFamilyId] = useState('');
  const [generatedInviteCode, setGeneratedInviteCode] = useState('');

  // Join state
  const [inviteCode, setInviteCode] = useState('');
  const [joinRequested, setJoinRequested] = useState(false);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const currentUser = useStore(state => state.currentUser);
  const navigate = useNavigate();

  const handleCreateFamily = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      const { familyId, inviteCode } = await createFamilyAndParent(currentUser.uid, currentUser.displayName, familyName);
      setGeneratedFamilyId(familyId);
      setGeneratedInviteCode(inviteCode);
      setStep(2);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async () => {
    if (!newMemberName.trim()) return;
    setLoading(true);
    try {
      await createManagedMember(generatedFamilyId, newMemberRole, newMemberName);
      setMembers([...members, { name: newMemberName, role: newMemberRole }]);
      setNewMemberName('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    setLoading(true);
    try {
      try {
        await requestToJoinFamily(currentUser.uid, currentUser.displayName, inviteCode);
      } catch (err: any) {
        if (err.message === 'Invalid invite code') {
          const { submitClaimRequest } = await import('../lib/api');
          await submitClaimRequest(currentUser.uid, currentUser.displayName, inviteCode);
        } else {
          throw err;
        }
      }
      setJoinRequested(true);
    } catch (err: any) {
      setError(err.message === 'Invalid invite code' || err.message === 'Invalid claim code' ? 'Invalid invite or claim code' : err.message);
    } finally {
      setLoading(false);
    }
  };

  if (joinRequested) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
        <div className="sm:mx-auto sm:w-full sm:max-w-md bg-white p-8 rounded-xl shadow text-center">
          <Shield className="w-16 h-16 text-primary-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Request Sent!</h2>
          <p className="text-gray-600 mb-6">The family owner needs to approve your request before you can join.</p>
          <Button fullWidth onClick={() => signOut()}>Sign Out</Button>
        </div>
      </div>
    );
  }

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
            <Button fullWidth size="lg" variant="secondary" onClick={() => setMode('join')}>I have an Invite / Claim Code</Button>
            <div className="pt-4 text-center">
              <button onClick={() => signOut()} className="text-sm text-gray-400 hover:text-gray-600">Sign Out</button>
            </div>
          </div>
        )}

        {mode === 'create' && step === 1 && (
          <form className="space-y-6" onSubmit={handleCreateFamily}>
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">Step 1 of 3</span>
              <h3 className="text-xl font-bold mt-1">Name your family</h3>
            </div>
            <div>
              <input type="text" required placeholder="e.g., The Smiths" value={familyName} onChange={e => setFamilyName(e.target.value)} className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md" />
            </div>
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-4">
              <Button type="button" variant="secondary" onClick={() => setMode('select')} disabled={loading}>Back</Button>
              <Button type="submit" className="flex-1" disabled={loading}>Continue</Button>
            </div>
          </form>
        )}

        {mode === 'create' && step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">Step 2 of 3</span>
              <h3 className="text-xl font-bold mt-1">Add Family Members</h3>
              <p className="text-sm text-gray-500 mt-2">Add children or partners who will share this device.</p>
            </div>

            <div className="space-y-3">
              {members.map((m, i) => (
                <div key={i} className="flex justify-between p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <span className="font-medium text-gray-900">{m.name}</span>
                  <span className="text-xs font-medium bg-gray-200 text-gray-700 px-2 py-1 rounded-full capitalize">{m.role}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input type="text" placeholder="Name" value={newMemberName} onChange={e => setNewMemberName(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
              <select value={newMemberRole} onChange={e => setNewMemberRole(e.target.value as any)} className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white">
                <option value="child">Child</option>
                <option value="parent">Parent</option>
              </select>
              <Button type="button" onClick={handleAddMember} disabled={loading || !newMemberName.trim()}><Plus size={16} /></Button>
            </div>

            <div className="pt-6 mt-6 border-t border-gray-100">
              <Button fullWidth onClick={() => setStep(3)}>Continue to Invite Code</Button>
            </div>
          </div>
        )}

        {mode === 'create' && step === 3 && (
          <div className="space-y-6 text-center">
            <div className="mb-6">
              <span className="text-xs font-bold text-primary-600 uppercase tracking-widest">Step 3 of 3</span>
              <h3 className="text-xl font-bold mt-1">Invite others to join</h3>
              <p className="text-sm text-gray-500 mt-2">Share this code with family members who have their own devices.</p>
            </div>

            <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
              <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-2">Your Invite Code</p>
              <p className="text-4xl font-mono font-black text-primary-600 tracking-widest">{generatedInviteCode}</p>
            </div>

            <Button fullWidth onClick={() => navigate('/')}>Finish Setup</Button>
          </div>
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
              <Button type="submit" className="flex-1" disabled={loading}>Request to Join</Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
