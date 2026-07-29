import {
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, googleProvider } from './firebase';

export type RedirectBootstrapResult =
  | { credential: UserCredential | null; error: null }
  | { credential: null; error: 'redirect-state-missing' };

const isMobileBrowser = () => {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile === true
    || /Android|iPhone|iPad|iPod/i.test(nav.userAgent);
};

async function ensureGoogleUserProfile(user: User) {
  const reference = doc(db, 'users', user.uid);
  if ((await getDoc(reference)).exists()) return;
  await setDoc(reference, {
    uid: user.uid,
    role: 'parent',
    displayName: user.displayName || 'User',
    avatarUrl: user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.displayName || 'User'}`,
    rewardPoints: 0,
    lifetimeXP: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: serverTimestamp(),
  });
}

export async function startGoogleAuthentication(
  options: { mobile?: boolean } = {},
) {
  if (options.mobile ?? isMobileBrowser()) {
    await signInWithRedirect(auth, googleProvider);
    return null;
  }
  const credential = await signInWithPopup(auth, googleProvider);
  await ensureGoogleUserProfile(credential.user);
  return credential.user;
}

let redirectBootstrap: Promise<RedirectBootstrapResult> | null = null;

export function consumeGoogleRedirectResult(): Promise<RedirectBootstrapResult> {
  if (redirectBootstrap) return redirectBootstrap;
  redirectBootstrap = getRedirectResult(auth)
    .then(async credential => {
      if (credential) await ensureGoogleUserProfile(credential.user);
      return { credential, error: null } as const;
    })
    .catch(error => {
      if (error?.code === 'auth/missing-initial-state') {
        return { credential: null, error: 'redirect-state-missing' } as const;
      }
      throw error;
    });
  return redirectBootstrap;
}
