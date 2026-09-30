import { auth } from '../lib/firebase';
import { useStore } from '../store/useStore';
import { refreshFamilyAuthority } from './familyAuthority';

export async function requireCurrentFamilyAuthority(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const allowed = await refreshFamilyAuthority(user);
  useStore.setState({ authUser: user });
  if (!allowed) throw new Error('EMAIL_VERIFICATION_REQUIRED');
}
