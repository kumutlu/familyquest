const projectId = 'familyquest-beta-402cb';
const host = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
const email = process.env.ONBOARDING_EMAIL;
if (!email) throw new Error('ONBOARDING_EMAIL_REQUIRED');

const response = await fetch(`http://${host}/emulator/v1/projects/${projectId}/oobCodes`);
if (!response.ok) throw new Error(`OOB_CODE_READ_FAILED_${response.status}`);
const body = await response.json() as { oobCodes?: Array<{ email?: string; oobLink?: string; requestType?: string }> };
const match = [...(body.oobCodes ?? [])].reverse().find(item =>
  item.email === email && item.requestType === 'VERIFY_EMAIL' && item.oobLink,
);
if (!match?.oobLink) throw new Error('VERIFICATION_LINK_NOT_FOUND');
process.stdout.write(match.oobLink);
