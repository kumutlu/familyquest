import {
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  type User,
  type UserCredential,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { bindPendingInviteToUid } from '../auth/pendingInviteIntent';
import { auth, db, googleProvider } from './firebase';

export type RedirectBootstrapResult =
  | { credential: UserCredential | null; error: null }
  | { credential: null; error: 'redirect-state-missing' }
  | { credential: UserCredential; error: 'invite-account-mismatch' };

const UNSAFE_RETURN_CHARACTERS = /[\\\s\p{Z}\u0000-\u001f\u007f-\u009f]/u;
const PERCENT_ENCODING = /%[0-9a-f]{2}/i;
const MALFORMED_PERCENT_ENCODING = /%(?![0-9a-f]{2})/i;

function decodedLayersAreUnsafe(value: string, authorityBearingPath: boolean): boolean {
  if (MALFORMED_PERCENT_ENCODING.test(value)) return true;
  if (UNSAFE_RETURN_CHARACTERS.test(value)) return true;
  if (authorityBearingPath && (value[0] !== '/' || value[1] === '/')) return true;
  if (!PERCENT_ENCODING.test(value)) return false;

  if (!authorityBearingPath) {
    try {
      return UNSAFE_RETURN_CHARACTERS.test(decodeURIComponent(value));
    } catch {
      return true;
    }
  }

  let current = value;
  for (let layer = 0; layer <= value.length; layer += 1) {
    if (UNSAFE_RETURN_CHARACTERS.test(current)) return true;
    if (authorityBearingPath && (current[0] !== '/' || current[1] === '/')) return true;
    if (!PERCENT_ENCODING.test(current)) return false;

    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return false;
      current = decoded;
    } catch {
      return true;
    }
  }

  return true;
}

/**
 * Validates an untrusted auth return value without normalising it. Only a
 * same-origin absolute path beginning with exactly one literal slash is safe.
 */
export function safeInternalReturnPath(value: string | null): string | null {
  if (!value) return null;

  const suffixIndex = value.search(/[?#]/);
  const path = suffixIndex === -1 ? value : value.slice(0, suffixIndex);
  const queryAndHash = suffixIndex === -1 ? '' : value.slice(suffixIndex);

  if (decodedLayersAreUnsafe(path, true)) return null;
  if (queryAndHash && decodedLayersAreUnsafe(queryAndHash, false)) return null;
  return value;
}

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
      if (credential) {
        await ensureGoogleUserProfile(credential.user);
        try {
          bindPendingInviteToUid(credential.user.uid);
        } catch (error) {
          if ((error as Error)?.message === 'INVITE_ACCOUNT_MISMATCH') {
            return { credential, error: 'invite-account-mismatch' } as const;
          }
          throw error;
        }
      }
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
