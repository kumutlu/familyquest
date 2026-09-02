export const EMAIL_ACTION_CONTINUE_PATH = '/verify-email';
export const EMAIL_ACTION_PATH = '/auth/action';

export type EmailActionKind = 'verifyEmail' | 'resetPassword' | 'recoverEmail' | 'verifyAndChangeEmail' | 'revertSecondFactorAddition';

export type VerificationActionRequest =
  | { kind: 'verifyEmail'; oobCode: string; locale: 'en' | 'tr' }
  | { kind: 'invalid' };

export type EmailActionRequest =
  | ({ kind: EmailActionKind; oobCode: string; locale: 'en' | 'tr' })
  | { kind: 'invalid' };

const supportedModes = new Set<EmailActionKind>([
  'verifyEmail', 'resetPassword', 'recoverEmail', 'verifyAndChangeEmail', 'revertSecondFactorAddition',
]);

export function parseEmailAction(search: string): EmailActionRequest {
  const params = new URLSearchParams(search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode')?.trim() ?? '';
  if (!mode || !supportedModes.has(mode as EmailActionKind) || !oobCode) return { kind: 'invalid' };
  return { kind: mode as EmailActionKind, oobCode, locale: params.get('lang') === 'tr' ? 'tr' : 'en' };
}

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
