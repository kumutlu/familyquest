import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

process.env.FIREBASE_AUTH_EMULATOR_HOST ||= '127.0.0.1:9099';
if (getApps().length === 0) initializeApp({ projectId: 'familyquest-beta-402cb' });
const email = process.env.ONBOARDING_EMAIL;
if (!email) throw new Error('ONBOARDING_EMAIL_REQUIRED');
const user = await getAuth().getUserByEmail(email);
process.stdout.write(JSON.stringify({ uid: user.uid, emailVerified: user.emailVerified }));
