export const EMAIL_ACTION_CONTINUE_PATH = '/verify-email';

export type VerificationActionRequest =
  | { kind: 'verifyEmail'; oobCode: string; locale: 'en' | 'tr' }
  | { kind: 'invalid' };

export function parseVerificationAction(search: string): VerificationActionRequest {
  const params = new URLSearchParams(search);
  const oobCode = params.get('oobCode')?.trim() ?? '';
  if (params.get('mode') !== 'verifyEmail' || !oobCode) return { kind: 'invalid' };

  const lang = params.get('lang');
  return {
    kind: 'verifyEmail',
    oobCode,
    locale: lang === 'tr' ? 'tr' : 'en',
  };
}
