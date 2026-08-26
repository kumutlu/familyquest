export type AuthErrorKey =
  | 'auth:errors.emailAlreadyUsedInvite'
  | 'auth:errors.emailAlreadyUsed'
  | 'auth:errors.invalidEmail'
  | 'auth:errors.invalidCredential'
  | 'auth:errors.popupClosed'
  | 'auth:errors.differentCredential'
  | 'auth:errors.network'
  | 'auth:errors.tooManyAttempts'
  | 'auth:errors.recentLogin'
  | 'auth:errors.methodDisabled'
  | 'auth:errors.generic';

/** Maps Firebase Auth failures to stable translation keys without reading raw messages. */
export function mapAuthErrorKey(
  error: unknown,
  context: { pendingInvite: boolean },
): AuthErrorKey {
  const code = (error as { code?: unknown } | null)?.code;
  switch (code) {
    case 'auth/email-already-in-use':
      return context.pendingInvite
        ? 'auth:errors.emailAlreadyUsedInvite'
        : 'auth:errors.emailAlreadyUsed';
    case 'auth/invalid-email':
      return 'auth:errors.invalidEmail';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'auth:errors.invalidCredential';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'auth:errors.popupClosed';
    case 'auth/account-exists-with-different-credential':
    case 'auth/credential-already-in-use':
      return 'auth:errors.differentCredential';
    case 'auth/network-request-failed':
      return 'auth:errors.network';
    case 'auth/too-many-requests':
      return 'auth:errors.tooManyAttempts';
    case 'auth/requires-recent-login':
      return 'auth:errors.recentLogin';
    case 'auth/operation-not-allowed':
      return 'auth:errors.methodDisabled';
    default:
      return 'auth:errors.generic';
  }
}
