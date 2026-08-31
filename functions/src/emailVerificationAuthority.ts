import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

export function requireFamilyAuthority(request: CallableRequest<unknown>): void {
  const provider = request.auth?.token?.firebase?.sign_in_provider;
  if (provider === 'password' && request.auth?.token?.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'EMAIL_VERIFICATION_REQUIRED');
  }
}
