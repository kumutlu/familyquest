// ---------------------------------------------------------------------------
// ACCOUNT DELETION — client API + reauthentication helpers
// ---------------------------------------------------------------------------
// The server (deleteAccount callable) is authoritative: it determines the
// caller's role from its own records and requires a recent login. This module
// wraps the callable and provides reauthentication for the two providers this
// app offers: email/password and Google. Sign in with Apple is NOT offered by
// this app, so Apple token revocation is not applicable.
// ---------------------------------------------------------------------------

import { httpsCallable } from 'firebase/functions';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
} from 'firebase/auth';
import { functions, auth } from './firebase';

export type DeleteAccountStatus = 'completed' | 'pending_family_deletion';

export interface DeleteAccountInput {
  successorUid?: string;
  familyNameConfirmation?: string;
}

export interface DeleteAccountResult {
  status: DeleteAccountStatus;
}

export async function requestAccountDeletion(input: DeleteAccountInput): Promise<DeleteAccountResult> {
  const callable = httpsCallable<DeleteAccountInput, DeleteAccountResult>(functions, 'deleteAccount');
  const result = await callable(input);
  return result.data;
}

/** Which reauthentication mechanism applies to the signed-in user. */
export function getReauthMethod(): 'password' | 'google' | null {
  const providers = (auth.currentUser?.providerData ?? []).map(p => p.providerId);
  if (providers.includes('password')) return 'password';
  if (providers.includes('google.com')) return 'google';
  return null;
}

export async function reauthenticateWithPassword(password: string): Promise<void> {
  const user = auth.currentUser;
  if (!user?.email) throw new Error('NO_PASSWORD_ACCOUNT');
  const credential = EmailAuthProvider.credential(user.email, password);
  await reauthenticateWithCredential(user, credential);
}

export async function reauthenticateWithGoogle(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('NOT_SIGNED_IN');
  await reauthenticateWithPopup(user, new GoogleAuthProvider());
}
